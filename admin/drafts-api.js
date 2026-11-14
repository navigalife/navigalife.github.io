/**
 * Private blog drafts. The site repo is public, so a draft (the post object the Blog
 * editor works on) and its images are kept in the MediVasc API worker's private D1
 * (traffic/worker.js, /drafts routes) until the owner publishes it into
 * data/blog/posts.json. Auth is the admin's own GitHub token, as for Traffic.
 *
 *   import { apiBase } from './traffic.js';
 *   const drafts = createDraftsApi({ endpoint: apiBase(), getToken: () => sessionToken() });
 *
 *   list()                      -> [{ id, slug, title, updated_at, updated_by, size, assets, asset_bytes }], newest first
 *   get(id)                     -> { id, slug, title, updated_at, updated_by, post, assets: [{ name, type, size, updated_at }] }
 *   version(id)                 -> { updated_at, updated_by }, or null when there is no draft with that id
 *       (checked before publishing or deleting, so an older copy never replaces or removes a newer one)
 *   save(id, post, ifMatch)     -> { id, updated_at }
 *       ifMatch = the updated_at you last loaded/saved: saves only over that version.
 *       ifMatch = null/undefined: creates a new draft (fails if the id exists).
 *       ifMatch = '*': saves over whatever is there (after the owner picks "keep mine").
 *   remove(id)                  -> { deleted }   (its images go with it)
 *   putAsset(id, name, blob)    -> { name, type, size, updated_at }  (save the draft first)
 *   assetUrl(id, name)          -> an object URL for <img src>; call URL.revokeObjectURL when done
 *   removeAsset(id, name)       -> { deleted }
 *
 * `updated_at` (ms since epoch) is the draft's version tag. Image uploads do not change it.
 * Every failure throws a DraftsError whose `message` can be shown to the owner as is,
 * with `code` for branching: 'network' | 'auth' | 'origin' | 'conflict' | 'not-found' |
 * 'too-large' | 'type' | 'invalid' | 'server'. A 'conflict' also carries
 * `serverUpdatedAt` (null = deleted elsewhere) and `updatedBy`.
 */
export const DRAFT_MAX_BYTES = 900 * 1000;
export const ASSET_MAX_BYTES = 1900 * 1000;
export const ASSET_NAME = /^[a-z0-9-]{1,80}\.(webp|jpg|png)$/;
const ASSET_TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };
const TYPE_LABELS = { 'image/webp': 'a WebP', 'image/jpeg': 'a JPEG', 'image/png': 'a PNG' };

export class DraftsError extends Error {
  constructor(message, { code = 'server', status = 0, serverUpdatedAt = null, updatedBy = '' } = {}) {
    super(message);
    this.name = 'DraftsError';
    this.code = code;
    this.status = status;
    this.serverUpdatedAt = serverUpdatedAt;
    this.updatedBy = updatedBy;
  }
}

const CONFLICT_TEXT = {
  changed: 'This draft was changed in another tab or on another device since you opened it. Reload it to see those changes, or save yours over them.',
  deleted: 'This draft was deleted in another tab or on another device. Save it again to keep it.',
  exists: 'A draft with this id already exists. Open it from the drafts list instead.',
};

// Status -> owner-readable error. The worker's own `error` text is plain words for the
// draft routes, so it is used where it is more specific than ours.
const failure = async (response, context) => {
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  const said = body && typeof body.error === 'string' ? body.error.slice(0, 200) : '';
  const { status } = response;
  if (status === 401) return new DraftsError('Drafts could not confirm your access. Lock the admin, unlock it again, and retry.', { code: 'auth', status });
  if (status === 403) return new DraftsError('Drafts can only be opened from the MediVasc admin.', { code: 'origin', status });
  if (status === 409) {
    const serverUpdatedAt = body && Number.isFinite(body.updated_at) ? body.updated_at : null;
    const kind = serverUpdatedAt == null ? 'deleted' : context.creating ? 'exists' : 'changed';
    return new DraftsError(CONFLICT_TEXT[kind], { code: 'conflict', status, serverUpdatedAt, updatedBy: (body && body.updated_by) || '' });
  }
  if (status === 404) return new DraftsError(said || 'That draft no longer exists. It may have been deleted.', { code: 'not-found', status });
  if (status === 413) return new DraftsError(said || 'That is too large to save.', { code: 'too-large', status });
  if (status === 415) return new DraftsError(said || 'Images must be WebP, JPEG or PNG.', { code: 'type', status });
  if (status === 400) return new DraftsError(said || 'The drafts service could not read that request.', { code: 'invalid', status });
  return new DraftsError(status === 500 && said ? said : 'The drafts service answered with an error (' + status + '). Try again in a minute.', { code: 'server', status });
};

const typeOfName = (name) => ASSET_TYPES[String(name).slice(String(name).lastIndexOf('.') + 1)] || '';

export const createDraftsApi = ({ endpoint, getToken }) => {
  const base = String(endpoint || '').replace(/\/+$/, '');
  const path = (id, name) => '/drafts' + (id == null ? '' : '/' + encodeURIComponent(id)) + (name == null ? '' : '/assets/' + encodeURIComponent(name));

  const request = async (method, url, { body, headers = {}, context = {} } = {}) => {
    let response;
    try {
      const token = await getToken();
      response = await fetch(base + url, { method, body, cache: 'no-store', headers: { Authorization: 'Bearer ' + (token || ''), ...headers } });
    } catch {
      throw new DraftsError('Could not reach the drafts service. Check the connection and try again.', { code: 'network' });
    }
    if (!response.ok) throw await failure(response, context);
    return response;
  };
  const asJson = async (response) => {
    try { return await response.json(); } catch { throw new DraftsError('The drafts service answered with something unexpected. Try again in a minute.', { code: 'server', status: response.status }); }
  };

  return {
    async list() {
      const data = await asJson(await request('GET', path()));
      return Array.isArray(data && data.drafts) ? data.drafts : [];
    },

    async get(id) {
      return asJson(await request('GET', path(id)));
    },

    // The worker has no lighter route: GET /drafts/:id answers the whole draft, or
    // 404 once it is gone (deleted, or published and removed).
    async version(id) {
      let got;
      try {
        got = await asJson(await request('GET', path(id)));
      } catch (error) {
        if (error.code === 'not-found') return null;
        throw error;
      }
      if (!got || !Number.isFinite(got.updated_at)) throw new DraftsError('The drafts service answered with something unexpected. Try again in a minute.', { code: 'server' });
      return { updated_at: got.updated_at, updated_by: typeof got.updated_by === 'string' ? got.updated_by : '' };
    },

    async save(id, post, ifMatch) {
      const body = JSON.stringify(post);
      if (new TextEncoder().encode(body).length > DRAFT_MAX_BYTES) {
        throw new DraftsError('This draft is too large to save (the limit is 900 KB of text). Move long sections into a second post.', { code: 'too-large' });
      }
      const headers = { 'Content-Type': 'application/json' };
      if (ifMatch != null) headers['If-Match'] = String(ifMatch);
      return asJson(await request('PUT', path(id), { body, headers, context: { creating: ifMatch == null } }));
    },

    async remove(id) {
      return asJson(await request('DELETE', path(id)));
    },

    async putAsset(id, name, blob) {
      if (!ASSET_NAME.test(name)) throw new DraftsError('Image names use lowercase letters, digits and hyphens, and end in .webp, .jpg or .png.', { code: 'invalid' });
      const type = typeOfName(name);
      if (blob.type && blob.type !== type) throw new DraftsError('This image is ' + (TYPE_LABELS[blob.type] || 'a ' + blob.type + ' file') + ' but its name ends in .' + name.split('.').pop() + '.', { code: 'type' });
      if (!blob.size) throw new DraftsError('The image is empty.', { code: 'invalid' });
      if (blob.size > ASSET_MAX_BYTES) throw new DraftsError('This image is too large (the limit is 1.9 MB). Export it smaller and try again.', { code: 'too-large' });
      return asJson(await request('PUT', path(id, name), { body: blob, headers: { 'Content-Type': type } }));
    },

    async assetUrl(id, name) {
      const response = await request('GET', path(id, name));
      return URL.createObjectURL(await response.blob());
    },

    async removeAsset(id, name) {
      return asJson(await request('DELETE', path(id, name)));
    },
  };
};
