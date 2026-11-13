const API_ROOT = 'https://api.github.com';

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export class AuthError extends ApiError {
  constructor(message = 'Your GitHub token is invalid or has expired.') {
    super(message, 401);
    this.name = 'AuthError';
  }
}

// Someone else (the advisor, another admin tab) published since this admin
// loaded. Raised both by the up-front HEAD check and when GitHub refuses the
// final branch move as "not a fast forward" — the same race, caught later.
export class BranchConflictError extends Error {
  constructor(currentSha = null) {
    super('Someone else published since you opened the admin, so nothing of yours was published yet.');
    this.name = 'BranchConflictError';
    this.currentSha = currentSha;
  }
}

// A data file on the branch that is not valid JSON. Not a token problem and not
// something a retry fixes on its own, so it is told apart from ApiError.
export class DataFileError extends Error {
  constructor(path, cause) {
    super(`${path} on GitHub is not valid JSON (${cause.message}).`);
    this.name = 'DataFileError';
    this.path = path;
  }
}

const utf8ToBase64 = (value) => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToUtf8 = (value) => {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const refPath = (branch) => branch.split('/').map(encodeURIComponent).join('/');

export class GhApi {
  constructor({ token, owner, repo, branch }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
  }

  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_ROOT}${path}`, {
        ...options,
        // GitHub serves ref/content GETs with `cache-control: max-age=60`; the
        // browser HTTP cache would otherwise let the optimistic-concurrency
        // check (getRef before publish) read a stale HEAD and spuriously throw
        // "Branch changed" for up to a minute after any push. Always hit the network.
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...options.headers,
        },
      });
    } catch (error) {
      throw new ApiError(`Network request failed: ${error.message}`, 0);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (response.status === 401) throw new AuthError();
    if (!response.ok) {
      const message = payload?.message || `GitHub request failed with status ${response.status}.`;
      throw new ApiError(message, response.status, payload);
    }
    return payload;
  }

  repoPath(suffix = '') {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${suffix}`;
  }

  async validate() {
    const repository = await this.request(this.repoPath());
    if (!repository.permissions?.push) {
      throw new ApiError('This token can read the repository but cannot publish changes.', 403);
    }
    await this.getRef();
    return repository;
  }

  getRef() {
    return this.request(this.repoPath(`/git/ref/heads/${refPath(this.branch)}`));
  }

  getCommit(sha) {
    return this.request(this.repoPath(`/git/commits/${encodeURIComponent(sha)}`));
  }

  async getJson(path) {
    const content = await this.request(this.repoPath(`/contents/${path}?ref=${encodeURIComponent(this.branch)}`));
    let data;
    try { data = JSON.parse(base64ToUtf8(content.content)); } catch (error) { throw new DataFileError(path, error); }
    return { data, sha: content.sha };
  }

  createBlob(content, encoding = 'utf-8') {
    return this.request(this.repoPath('/git/blobs'), {
      method: 'POST',
      body: JSON.stringify({ content, encoding }),
    });
  }

  createTree(baseTree, tree) {
    return this.request(this.repoPath('/git/trees'), {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTree, tree }),
    });
  }

  createCommit(message, tree, parents) {
    return this.request(this.repoPath('/git/commits'), {
      method: 'POST',
      body: JSON.stringify({ message, tree, parents }),
    });
  }

  updateRef(sha) {
    return this.request(this.repoPath(`/git/refs/heads/${refPath(this.branch)}`), {
      method: 'PATCH',
      body: JSON.stringify({ sha, force: false }),
    });
  }

  async publish(changes, expectedBaseSha, message) {
    const currentRef = await this.getRef();
    if (currentRef.object.sha !== expectedBaseSha) {
      throw new BranchConflictError(currentRef.object.sha);
    }
    const baseCommit = await this.getCommit(expectedBaseSha);
    const treeEntries = await Promise.all(changes.map(async (change) => {
      if (change.delete) return { path: change.path, mode: '100644', type: 'blob', sha: null };
      const blob = await this.createBlob(change.content, change.encoding || 'utf-8');
      return { path: change.path, mode: '100644', type: 'blob', sha: blob.sha };
    }));
    const tree = await this.createTree(baseCommit.tree.sha, treeEntries);
    const commit = await this.createCommit(message, tree.sha, [expectedBaseSha]);
    try {
      await this.updateRef(commit.sha);
    } catch (error) {
      // The branch moved between getRef above and this update. The commit made
      // here is simply left unreferenced; nothing on the branch changed.
      if ((error.status === 422 || error.status === 409) && /fast.?forward|reference update failed/i.test(error.message)) {
        throw new BranchConflictError();
      }
      throw error;
    }
    return commit;
  }

  // Recent workflow runs on the branch, newest first.
  listBranchRuns() {
    const query = new URLSearchParams({ branch: this.branch, per_page: '20' });
    return this.request(this.repoPath(`/actions/runs?${query}`)).then((payload) => payload.workflow_runs || []);
  }

  listRuns(commitSha) {
    return this.listBranchRuns().then((runs) => runs.filter((run) => run.head_sha === commitSha));
  }

  dispatchWorkflow() {
    return this.request(this.repoPath('/actions/workflows/deploy.yml/dispatches'), {
      method: 'POST',
      body: JSON.stringify({ ref: 'main' }),
    });
  }

  // A workflow's state: 'active', 'disabled_inactivity' (GitHub switches a
  // scheduled workflow off after 60 days without repo activity),
  // 'disabled_manually', … A workflow file that does not exist is 'missing'.
  async workflowState(file) {
    try {
      const workflow = await this.request(this.repoPath(`/actions/workflows/${encodeURIComponent(file)}`));
      return String(workflow?.state || 'unknown');
    } catch (error) {
      if (error instanceof ApiError && !(error instanceof AuthError) && error.status === 404) return 'missing';
      throw error;
    }
  }

  async enableWorkflow(file) {
    await this.request(this.repoPath(`/actions/workflows/${encodeURIComponent(file)}/enable`), { method: 'PUT' });
  }

  // Commits on the admin's branch that touched `path`, newest first.
  async listCommits(path, { perPage = 30 } = {}) {
    const query = new URLSearchParams({ path, sha: this.branch, per_page: String(perPage) });
    const commits = await this.request(this.repoPath(`/commits?${query}`));
    return (Array.isArray(commits) ? commits : []).map((item) => ({
      sha: item.sha,
      date: item.commit?.committer?.date || item.commit?.author?.date || '',
      message: String(item.commit?.message || '').split('\n')[0],
      author: item.commit?.author?.name || item.author?.login || '',
    }));
  }

  // A file's text as it was at `ref` (a commit sha, branch or tag). The contents
  // API inlines files up to 1 MB; above that it returns `encoding: 'none'` with
  // empty content, so the text comes from the blob API (good to 100 MB).
  async getFileAt(path, ref) {
    const query = new URLSearchParams({ ref });
    const file = await this.request(this.repoPath(`/contents/${refPath(path)}?${query}`));
    if (!file || Array.isArray(file) || (file.type && file.type !== 'file')) {
      throw new ApiError(`${path} is not a file at ${String(ref).slice(0, 7)}.`, 422, file);
    }
    if (file.encoding === 'base64' && typeof file.content === 'string' && (file.content || !file.size)) {
      return base64ToUtf8(file.content);
    }
    const blob = await this.request(this.repoPath(`/git/blobs/${encodeURIComponent(file.sha)}`));
    if (blob?.encoding === 'base64') return base64ToUtf8(blob.content || '');
    return String(blob?.content ?? '');
  }

  static jsonChange(path, value) {
    return { path, content: `${JSON.stringify(value, null, 2)}\n`, encoding: 'utf-8' };
  }

  static utf8ToBase64(value) {
    return utf8ToBase64(value);
  }
}
