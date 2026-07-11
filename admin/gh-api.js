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

export class BranchConflictError extends Error {
  constructor(currentSha) {
    super('The branch changed after this editor loaded. Reload the source and reapply your draft before publishing.');
    this.name = 'BranchConflictError';
    this.currentSha = currentSha;
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
    return { data: JSON.parse(base64ToUtf8(content.content)), sha: content.sha };
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
    await this.updateRef(commit.sha);
    return commit;
  }

  listRuns(commitSha) {
    const query = new URLSearchParams({ branch: this.branch, per_page: '20' });
    return this.request(this.repoPath(`/actions/runs?${query}`)).then((payload) =>
      payload.workflow_runs.filter((run) => run.head_sha === commitSha));
  }

  dispatchWorkflow() {
    return this.request(this.repoPath('/actions/workflows/deploy.yml/dispatches'), {
      method: 'POST',
      body: JSON.stringify({ ref: this.branch }),
    });
  }

  static jsonChange(path, value) {
    return { path, content: `${JSON.stringify(value, null, 2)}\n`, encoding: 'utf-8' };
  }

  static utf8ToBase64(value) {
    return utf8ToBase64(value);
  }
}
