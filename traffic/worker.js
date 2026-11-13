// MediVasc traffic collector: Cloudflare Worker + D1.
//
// POST /p  (from the public site, src/site.js) — one ping per visit and one for
//          its first enquiry tap (w/c/e = the channel tapped first). Classified into a source bucket HERE, so the rules can
//          change without a site deploy, then folded into a per-day tally. No
//          IP, cookie, or per-visitor row is ever stored: only counts keyed by
//          (IST day, kind, source, device, country, region, city).
// GET  /s  (from the admin's Traffic tab, admin/traffic.js) — tallies for a
//          date range. Auth = the admin's own GitHub token: whoever can publish
//          the site can read its traffic. The token is checked against GitHub
//          and never stored (only a hash, in memory, for a few minutes).
// POST /cutout (from the admin's recovery-photo crop dialog, admin/image-tools.js)
//          — background removal via the Cloudflare Images binding
//          (segment: foreground). Same token auth as /s. The photo is processed
//          in memory and returned as an RGBA PNG; nothing is stored.
// GET  /blog-stats (Traffic tab) — per-post reading counts (table blog_daily).
// /drafts... (the admin's Blog tab, admin/drafts-api.js) — private blog drafts
//          and their images. The site repo is public, so drafts live only here.
//          Both use the same token auth as /s; see the route table further down.
// Tables: schema.sql (daily) + migrations/0002_blog.sql (drafts, draft_assets, blog_daily).

const SITE_ORIGINS = new Set(['https://medivasc.in', 'https://www.medivasc.in']);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const REPO = 'navigalife/navigalife.github.io';
const KINDS = new Set(['v', 'w', 'c', 'e']); // visit, WhatsApp tap, call tap, email tap
// A blog page path ('blog/', 'blog/<slug>/', 'blog/category/<slug>/'…), sent by the
// tracker as `b` on blog pages only. Kind 'b' = a later blog page in the same visit:
// it counts in blog_daily only, never as a visit in `daily`.
const BLOG_PATH = /^blog\/[a-z0-9/-]{0,120}$/;

// Non-human agents that execute JavaScript (link-preview fetchers mostly don't).
export const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|monitor|preview|prerender|phantom|puppeteer|playwright|selenium|curl|wget|python|axios|node-fetch|go-http|java\//i;

// utm_source aliases -> bucket. Anything else tagged lands in "other" with the tag kept.
const UTM = {
  google: 'google', youtube: 'youtube', yt: 'youtube', facebook: 'facebook', fb: 'facebook', meta: 'facebook',
  instagram: 'instagram', ig: 'instagram', insta: 'instagram', linkedin: 'linkedin', li: 'linkedin',
  x: 'x', twitter: 'x', whatsapp: 'whatsapp', wa: 'whatsapp',
};

// AI assistants share one bucket, "ai"; the assistant's name is kept as ref so
// the admin can say which one sent the visit. Hosts are matched exactly (after
// "www."), and before HOSTS, whose google pattern would take gemini.google.com.
// Android package names (android-app:// referrers) are the ones whose Google
// Play page was checked on 2026-11-10. Copilot's is left out: no id we tried
// (com.microsoft.copilot, com.microsoft.copilot.android) has a Play page.
const AI_TAGS = {
  'chatgpt.com': 'ChatGPT', chatgpt: 'ChatGPT', openai: 'ChatGPT', perplexity: 'Perplexity', 'perplexity.ai': 'Perplexity',
  gemini: 'Gemini', claude: 'Claude', 'claude.ai': 'Claude', copilot: 'Copilot', grok: 'Grok', deepseek: 'DeepSeek', 'meta.ai': 'Meta AI',
};
const AI_HOSTS = {
  'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT', 'com.openai.chatgpt': 'ChatGPT',
  'perplexity.ai': 'Perplexity', 'ai.perplexity.app.android': 'Perplexity',
  'gemini.google.com': 'Gemini', 'bard.google.com': 'Gemini', 'com.google.android.apps.bard': 'Gemini',
  'claude.ai': 'Claude', 'com.anthropic.claude': 'Claude',
  'copilot.microsoft.com': 'Copilot', 'copilot.cloud.microsoft': 'Copilot',
  'meta.ai': 'Meta AI', 'com.facebook.stella': 'Meta AI',
  'grok.com': 'Grok', 'ai.x.grok': 'Grok',
  'chat.deepseek.com': 'DeepSeek', 'com.deepseek.chat': 'DeepSeek',
};

// Referrer host -> bucket. android-app:// referrers arrive as the package name.
const HOSTS = [
  ['google', /(^|\.)google\.[a-z.]{2,7}$|^com\.google\.android\.googlequicksearchbox$/],
  ['youtube', /(^|\.)youtube\.com$|^youtu\.be$|^com\.google\.android\.youtube$/],
  ['facebook', /(^|\.)facebook\.com$|^fb\.(com|me)$|^com\.facebook\.(katana|lite|orca)$/],
  ['instagram', /(^|\.)instagram\.com$|^com\.instagram\.android$/],
  ['linkedin', /(^|\.)linkedin\.com$|^lnkd\.in$|^com\.linkedin\.android$/],
  ['x', /^t\.co$|(^|\.)(x|twitter)\.com$|^com\.twitter\.android$/],
  ['whatsapp', /(^|\.)whatsapp\.com$|^wa\.me$|^com\.whatsapp(\.w4b)?$/],
];

export const classify = (utm, ref, ua) => {
  const tag = String(utm || '').trim().toLowerCase().slice(0, 40);
  if (tag) { // hasOwn: 'constructor' etc. are not buckets
    if (Object.hasOwn(UTM, tag)) return [UTM[tag], ''];
    return Object.hasOwn(AI_TAGS, tag) ? ['ai', AI_TAGS[tag]] : ['other', 'tag: ' + tag];
  }
  // In-app browsers often send no referrer, but they name themselves in the UA.
  if (/Instagram/i.test(ua)) return ['instagram', ''];
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A|MessengerForiOS/.test(ua)) return ['facebook', ''];
  if (/LinkedInApp/i.test(ua)) return ['linkedin', ''];
  if (/TwitterAndroid|Twitter for iPhone/i.test(ua)) return ['x', ''];
  const host = String(ref || '').trim().toLowerCase().replace(/^www\./, '').slice(0, 80);
  if (!host || host === 'medivasc.in') return ['direct', ''];
  if (/^mail\.google\./.test(host)) return ['other', host];
  if (Object.hasOwn(AI_HOSTS, host)) return ['ai', AI_HOSTS[host]];
  for (const [bucket, pattern] of HOSTS) if (pattern.test(host)) return [bucket, ''];
  return ['other', host];
};

const device = (ua) => (/iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop');
const istDay = (ms = Date.now()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const clip = (value, max) => String(value || '').slice(0, max);

const allowedAdminOrigin = (origin, env) => SITE_ORIGINS.has(origin) || (env.ALLOW_LOCAL === '1' && LOCAL_ORIGIN.test(origin));

// Local development only: `traffic/.dev.vars` (gitignored) sets ALLOW_LOCAL=1, which
// lets localhost origins in and skips the GitHub token check. The skip also needs the
// request itself to be served from localhost, so even a stray ALLOW_LOCAL on the
// deployed worker (served from *.workers.dev) can never open the admin routes.
const localDev = (request, env) => env.ALLOW_LOCAL === '1' && /^(localhost|127\.0\.0\.1)$/.test(new URL(request.url).hostname);

const cors = (origin, env) => (allowedAdminOrigin(origin, env)
  ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
  : { Vary: 'Origin' });
const preflight = (request, env) => new Response(null, { status: 204, headers: cors(request.headers.get('Origin') || '', env) });

const json = (body, status, headers) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});

async function collect(request, env) {
  const origin = request.headers.get('Origin') || '';
  const okOrigin = SITE_ORIGINS.has(origin) || (env.ALLOW_LOCAL === '1' && LOCAL_ORIGIN.test(origin));
  const ua = request.headers.get('User-Agent') || '';
  if (!okOrigin || !ua || BOT.test(ua)) return new Response(null, { status: 204 });
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'none' });
    if (!success) return new Response(null, { status: 204 });
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > 1024) return new Response(null, { status: 204 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }
  const blog = body && typeof body.b === 'string' && BLOG_PATH.test(body.b) ? body.b : '';
  if (body && body.k === 'b') { // a later blog page of a visit already counted
    if (blog) await countBlog(env, blog, 'visits');
    return new Response(null, { status: 204 });
  }
  const kind = body && KINDS.has(body.k) ? body.k : null; // body may be JSON null
  if (!kind) return new Response(null, { status: 204 });
  const [source, ref] = classify(body.u, body.r, ua);
  const cf = request.cf || {};
  await env.DB.prepare(
    `INSERT INTO daily (day, kind, source, ref, device, country, region, city, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
     ON CONFLICT (day, kind, source, ref, device, country, region, city) DO UPDATE SET n = n + 1`,
  ).bind(istDay(), kind, source, ref, device(ua), clip(cf.country, 2), clip(cf.region, 60), clip(cf.city, 60)).run();
  if (blog) await countBlog(env, blog, kind === 'v' ? 'visits' : 'enquiries');
  return new Response(null, { status: 204 });
}

// Per-post tally. Runs after (never inside) the `daily` write, and swallows its own
// errors, so a missing blog_daily table can never cost the main visit count.
async function countBlog(env, path, column) {
  const sql = column === 'visits'
    ? 'INSERT INTO blog_daily (day, path, visits, enquiries) VALUES (?1, ?2, 1, 0) ON CONFLICT (day, path) DO UPDATE SET visits = visits + 1'
    : 'INSERT INTO blog_daily (day, path, visits, enquiries) VALUES (?1, ?2, 0, 1) ON CONFLICT (day, path) DO UPDATE SET enquiries = enquiries + 1';
  try { await env.DB.prepare(sql).bind(istDay(), path).run(); } catch { /* counted in daily already */ }
}

// token-hash -> expiry (ms). Per isolate; a cold isolate just re-checks GitHub.
const verified = new Map();
const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

const github = (token, path) => fetch('https://api.github.com' + path, {
  headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'medivasc-api', 'X-GitHub-Api-Version': '2022-11-28' },
});
const bearer = (request) => (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

async function canPublish(token) {
  const key = await sha256(token);
  if ((verified.get(key) || 0) > Date.now()) return true;
  const gh = (path) => github(token, path);
  let ok = false;
  const repo = await gh('/repos/' + REPO);
  if (repo.ok) {
    const data = await repo.json();
    if (data.permissions) ok = Boolean(data.permissions.push || data.permissions.admin || data.permissions.maintain);
    else {
      // Some fine-grained tokens omit `permissions`; ask for the token owner's role instead.
      const user = await gh('/user');
      if (user.ok) {
        const { login } = await user.json();
        const role = await gh('/repos/' + REPO + '/collaborators/' + encodeURIComponent(login) + '/permission');
        if (role.ok) ok = ['admin', 'maintain', 'write'].includes((await role.json()).permission);
      }
    }
  }
  if (ok) verified.set(key, Date.now() + 10 * 60000);
  return ok;
}

// Admin-only routes: allowed origin + a token that can publish the site.
async function adminGate(request, env) {
  const origin = request.headers.get('Origin') || '';
  const headers = cors(origin, env);
  if (!allowedAdminOrigin(origin, env)) return { headers, denied: json({ error: 'origin' }, 403, headers) };
  const token = bearer(request);
  const authorised = localDev(request, env) || (token && (await canPublish(token)));
  return { headers, denied: authorised ? null : json({ error: 'unauthorised' }, 401, headers) };
}

// GitHub login behind a token (for drafts.updated_by), cached like `verified`.
// Only called after adminGate passed; '' when GitHub does not say.
const logins = new Map(); // token-hash -> { login, until }
async function editorLogin(request, env) {
  if (localDev(request, env)) return 'local';
  const token = bearer(request);
  const key = await sha256(token);
  const hit = logins.get(key);
  if (hit && hit.until > Date.now()) return hit.login;
  let login = '';
  try {
    const user = await github(token, '/user');
    if (user.ok) login = clip((await user.json()).login, 60);
  } catch { /* leave it blank */ }
  logins.set(key, { login, until: Date.now() + 10 * 60000 });
  return login;
}

const CUTOUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CUTOUT_MAX_BYTES = 15 * 1024 * 1024; // the binding's own input cap is 20 MB

async function cutout(request, env) {
  const { headers, denied } = await adminGate(request, env);
  if (denied) return denied;
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!CUTOUT_TYPES.has(type)) return json({ error: 'type' }, 415, headers);
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > CUTOUT_MAX_BYTES) return json({ error: 'size' }, 413, headers);
  try {
    // No `quality` on PNG output: that switches to palette PNG8 and loses the soft alpha.
    const result = await env.IMAGES.input(new Blob([body]).stream())
      .transform({ segment: 'foreground' })
      .output({ format: 'image/png' });
    return new Response(result.response().body, {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', ...headers },
    });
  } catch (error) {
    // 9422 = the Free plan's monthly transformation allowance is used up.
    const limit = /9422/.test(String(error && error.message));
    return json({ error: limit ? 'limit' : 'cutout' }, limit ? 429 : 502, headers);
  }
}

// ?from=&to= (IST days, inclusive); missing or malformed = all time up to today.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayRange = (url) => ({
  from: DAY.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : '2000-01-01',
  to: DAY.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : istDay(),
});

async function stats(request, env, url) {
  const { headers, denied } = await adminGate(request, env);
  if (denied) return denied;
  const { from, to } = dayRange(url);
  const [rows, first] = await env.DB.batch([
    env.DB.prepare('SELECT day, kind, source, ref, device, country, region, city, n FROM daily WHERE day BETWEEN ?1 AND ?2').bind(from, to),
    env.DB.prepare('SELECT MIN(day) AS first FROM daily'),
  ]);
  return json({
    today: istDay(),
    first: first.results[0]?.first || null,
    rows: rows.results.map((r) => [r.day, r.kind, r.source, r.ref, r.device, r.country, r.region, r.city, r.n]),
  }, 200, headers);
}

// GET /blog-stats?from=&to= -> { today, from, to, rows: [[path, visits, enquiries]] },
// one row per blog page, most-read first.
async function blogStats(request, env, url) {
  const { headers, denied } = await adminGate(request, env);
  if (denied) return denied;
  const { from, to } = dayRange(url);
  try {
    const { results } = await env.DB.prepare(
      `SELECT path, SUM(visits) AS visits, SUM(enquiries) AS enquiries FROM blog_daily
       WHERE day BETWEEN ?1 AND ?2 GROUP BY path ORDER BY visits DESC, enquiries DESC, path`,
    ).bind(from, to).all();
    return json({ today: istDay(), from, to, rows: results.map((r) => [r.path, r.visits, r.enquiries]) }, 200, headers);
  } catch {
    return json({ error: 'Blog reading counts are not set up yet.' }, 500, headers);
  }
}

// ---- Private blog drafts (admin only, every route behind adminGate) ----------
// GET    /drafts                    -> { drafts: [{ id, slug, title, updated_at, updated_by,
//                                        size (JSON bytes), assets (count), asset_bytes }] }, newest first
// GET    /drafts/:id                -> { id, slug, title, updated_at, updated_by, post,
//                                        assets: [{ name, type, size, updated_at }] }
// PUT    /drafts/:id                body = the post object (JSON, <= 900 KB) -> { id, updated_at }
//          If-Match: <updated_at>   save over exactly that version
//          no If-Match              create only (the id must be new)
//          If-Match: *              save over whatever is there (the "keep mine" choice)
//          any mismatch -> 409 { error, updated_at, updated_by } (updated_at null = deleted)
// DELETE /drafts/:id                -> { deleted } (its images go with it)
// PUT    /drafts/:id/assets/:name   image body (webp|jpeg|png, <= 1.9 MB; the draft must
//                                    exist) -> { name, type, size, updated_at }. Does not
//                                    change the draft's updated_at.
// GET    /drafts/:id/assets/:name   the bytes, Cache-Control: private, no-store
// DELETE /drafts/:id/assets/:name   -> { deleted }
// updated_at = ms since epoch, strictly increasing per draft (it is the version tag).
const DRAFTS = /^\/drafts(?:\/([^/]+)(?:\/assets\/([^/]+))?)?$/;
const DRAFT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ASSET_NAME = /^[a-z0-9-]{1,80}\.(webp|jpg|png)$/;
const ASSET_TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };
const DRAFT_MAX_BYTES = 900 * 1000;
const ASSET_MAX_BYTES = 1900 * 1000; // D1 caps one row at 2,000,000 bytes
const ASSETS_PER_DRAFT = 80;

const contentType = (request) => (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
const declaredOver = (request, max) => Number(request.headers.get('Content-Length') || 0) > max;
// If-Match: '123' / '"123"' / 'W/"123"' -> 123; '*' -> '*'; absent -> null; anything else -> undefined.
const ifMatch = (request) => {
  const raw = request.headers.get('If-Match');
  if (raw == null) return null;
  const value = raw.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  if (value === '*') return '*';
  return /^\d{1,16}$/.test(value) ? Number(value) : undefined;
};

async function drafts(request, env, id, name) {
  const { headers, denied } = await adminGate(request, env);
  if (denied) return denied;
  const fail = (status, error, extra) => json({ error, ...extra }, status, headers);
  if (id !== undefined && !DRAFT_ID.test(id)) return fail(400, 'That draft id is not valid.');
  if (name !== undefined && !ASSET_NAME.test(name)) return fail(400, 'Image names use lowercase letters, digits and hyphens, and end in .webp, .jpg or .png.');
  const route = (id === undefined ? 'list' : name === undefined ? 'draft' : 'asset') + ' ' + request.method;
  try {
    switch (route) {
      case 'list GET': return await listDrafts(env, headers);
      case 'draft GET': return await getDraft(env, headers, fail, id);
      case 'draft PUT': return await saveDraft(request, env, headers, fail, id);
      case 'draft DELETE': {
        const [, gone] = await env.DB.batch([
          env.DB.prepare('DELETE FROM draft_assets WHERE draft_id = ?1').bind(id),
          env.DB.prepare('DELETE FROM drafts WHERE id = ?1').bind(id),
        ]);
        return json({ deleted: gone.meta.changes > 0 }, 200, headers);
      }
      case 'asset GET': {
        const row = await env.DB.prepare('SELECT type, bytes FROM draft_assets WHERE draft_id = ?1 AND name = ?2').bind(id, name).first();
        if (!row) return fail(404, 'This draft has no image by that name.');
        return new Response(new Uint8Array(row.bytes), {
          status: 200,
          headers: { 'Content-Type': row.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
        });
      }
      case 'asset PUT': return await saveAsset(request, env, headers, fail, id, name);
      case 'asset DELETE': {
        const gone = await env.DB.prepare('DELETE FROM draft_assets WHERE draft_id = ?1 AND name = ?2').bind(id, name).run();
        return json({ deleted: gone.meta.changes > 0 }, 200, headers);
      }
      default: return fail(405, 'That action is not supported here.');
    }
  } catch {
    return fail(500, 'The drafts store had a problem. Try again in a minute.');
  }
}

async function listDrafts(env, headers) {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.slug, d.title, d.updated_at, d.updated_by, length(CAST(d.json AS BLOB)) AS size,
       COUNT(a.name) AS assets, COALESCE(SUM(a.size), 0) AS asset_bytes
     FROM drafts d LEFT JOIN draft_assets a ON a.draft_id = d.id
     GROUP BY d.id ORDER BY d.updated_at DESC`,
  ).all();
  return json({ drafts: results }, 200, headers);
}

async function getDraft(env, headers, fail, id) {
  const [draft, assets] = await env.DB.batch([
    env.DB.prepare('SELECT id, slug, title, json, updated_at, updated_by FROM drafts WHERE id = ?1').bind(id),
    env.DB.prepare('SELECT name, type, size, updated_at FROM draft_assets WHERE draft_id = ?1 ORDER BY name').bind(id),
  ]);
  const row = draft.results[0];
  if (!row) return fail(404, 'There is no draft with that id. It may have been deleted.');
  const { json: text, ...meta } = row;
  return json({ ...meta, post: JSON.parse(text), assets: assets.results }, 200, headers);
}

async function saveDraft(request, env, headers, fail, id) {
  const tooBig = 'This draft is too large to save (the limit is 900 KB of text). Move long sections into a second post.';
  const match = ifMatch(request);
  if (match === undefined) return fail(400, 'If-Match must be the draft’s updated_at, or *.');
  if (declaredOver(request, DRAFT_MAX_BYTES)) return fail(413, tooBig);
  const raw = await request.arrayBuffer();
  if (raw.byteLength > DRAFT_MAX_BYTES) return fail(413, tooBig);
  let post;
  try { post = JSON.parse(new TextDecoder().decode(raw)); } catch { return fail(400, 'The draft could not be read (it is not valid JSON).'); }
  if (!post || typeof post !== 'object' || Array.isArray(post)) return fail(400, 'A draft must be a post object.');
  if (post.id != null && post.id !== id) return fail(400, 'The post id inside the draft does not match the draft it is saved to.');
  const fields = [
    id,
    clip(typeof post.slug === 'string' ? post.slug : '', 120),
    clip(typeof post.title === 'string' ? post.title : '', 300),
    JSON.stringify(post),
    Date.now(),
    await editorLogin(request, env),
  ];
  const insert = 'INSERT INTO drafts (id, slug, title, json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)';
  const statement = match === null
    ? env.DB.prepare(insert + ' ON CONFLICT (id) DO NOTHING RETURNING updated_at').bind(...fields)
    : match === '*'
      ? env.DB.prepare(insert + ` ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, title = excluded.title, json = excluded.json,
          updated_at = MAX(excluded.updated_at, drafts.updated_at + 1), updated_by = excluded.updated_by RETURNING updated_at`).bind(...fields)
      : env.DB.prepare(`UPDATE drafts SET slug = ?2, title = ?3, json = ?4, updated_at = MAX(?5, updated_at + 1), updated_by = ?6
          WHERE id = ?1 AND updated_at = ?7 RETURNING updated_at`).bind(...fields, match);
  const saved = await statement.first();
  if (saved) return json({ id, updated_at: saved.updated_at }, 200, headers);
  const current = await env.DB.prepare('SELECT updated_at, updated_by FROM drafts WHERE id = ?1').bind(id).first();
  const error = !current ? 'This draft was deleted in another tab or on another device.'
    : match === null ? 'A draft with this id already exists. Open it from the drafts list instead.'
      : 'This draft was changed in another tab or on another device since you opened it.';
  return fail(409, error, { updated_at: current ? current.updated_at : null, updated_by: current ? current.updated_by : '' });
}

async function saveAsset(request, env, headers, fail, id, name) {
  const type = ASSET_TYPES[name.slice(name.lastIndexOf('.') + 1)];
  const tooBig = 'This image is too large (the limit is 1.9 MB). Export it smaller and try again.';
  if (contentType(request) !== type) return fail(415, 'This image must be sent as ' + type + ' to match its name.');
  if (declaredOver(request, ASSET_MAX_BYTES)) return fail(413, tooBig);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return fail(400, 'The image is empty.');
  if (bytes.byteLength > ASSET_MAX_BYTES) return fail(413, tooBig);
  const [draft, others] = await env.DB.batch([
    env.DB.prepare('SELECT 1 AS ok FROM drafts WHERE id = ?1').bind(id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM draft_assets WHERE draft_id = ?1 AND name != ?2').bind(id, name),
  ]);
  if (!draft.results.length) return fail(404, 'Save the draft before adding images to it.');
  if (others.results[0].n >= ASSETS_PER_DRAFT) return fail(413, 'This draft already has ' + ASSETS_PER_DRAFT + ' images. Remove some before adding more.');
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO draft_assets (draft_id, name, type, bytes, size, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (draft_id, name) DO UPDATE SET type = excluded.type, bytes = excluded.bytes, size = excluded.size, updated_at = excluded.updated_at`,
  ).bind(id, name, type, bytes, bytes.byteLength, now).run();
  return json({ name, type, size: bytes.byteLength, updated_at: now }, 200, headers);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/p' && request.method === 'POST') return collect(request, env);
    if (url.pathname === '/s') {
      if (request.method === 'OPTIONS') return preflight(request, env);
      if (request.method === 'GET') return stats(request, env, url);
    }
    if (url.pathname === '/blog-stats') {
      if (request.method === 'OPTIONS') return preflight(request, env);
      if (request.method === 'GET') return blogStats(request, env, url);
    }
    if (url.pathname === '/cutout') {
      if (request.method === 'OPTIONS') return preflight(request, env);
      if (request.method === 'POST') return cutout(request, env);
    }
    const route = DRAFTS.exec(url.pathname);
    if (route) return request.method === 'OPTIONS' ? preflight(request, env) : drafts(request, env, route[1], route[2]);
    return new Response('Not found', { status: 404 });
  },
};
