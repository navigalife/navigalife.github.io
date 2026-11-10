// MediVasc traffic collector: Cloudflare Worker + D1.
//
// POST /p  (from the public site, src/site.js) — one ping per visit and per
//          enquiry tap. Classified into a source bucket HERE, so the rules can
//          change without a site deploy, then folded into a per-day tally. No
//          IP, cookie, or per-visitor row is ever stored: only counts keyed by
//          (IST day, kind, source, device, country, region, city).
// GET  /s  (from the admin's Traffic tab, admin/traffic.js) — tallies for a
//          date range. Auth = the admin's own GitHub token: whoever can publish
//          the site can read its traffic. The token is checked against GitHub
//          and never stored (only a hash, in memory, for a few minutes).

const SITE_ORIGINS = new Set(['https://medivasc.in', 'https://www.medivasc.in']);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const REPO = 'navigalife/navigalife.github.io';
const KINDS = new Set(['v', 'w', 'c', 'e']); // visit, WhatsApp tap, call tap, email tap

// Non-human agents that execute JavaScript (link-preview fetchers mostly don't).
export const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|monitor|preview|prerender|phantom|puppeteer|playwright|selenium|curl|wget|python|axios|node-fetch|go-http|java\//i;

// utm_source aliases -> bucket. Anything else tagged lands in "other" with the tag kept.
const UTM = {
  google: 'google', youtube: 'youtube', yt: 'youtube', facebook: 'facebook', fb: 'facebook', meta: 'facebook',
  instagram: 'instagram', ig: 'instagram', insta: 'instagram', linkedin: 'linkedin', li: 'linkedin',
  x: 'x', twitter: 'x', whatsapp: 'whatsapp', wa: 'whatsapp',
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
  if (tag) return Object.hasOwn(UTM, tag) ? [UTM[tag], ''] : ['other', 'tag: ' + tag]; // hasOwn: 'constructor' etc. are not buckets
  // In-app browsers often send no referrer, but they name themselves in the UA.
  if (/Instagram/i.test(ua)) return ['instagram', ''];
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A|MessengerForiOS/.test(ua)) return ['facebook', ''];
  if (/LinkedInApp/i.test(ua)) return ['linkedin', ''];
  if (/TwitterAndroid|Twitter for iPhone/i.test(ua)) return ['x', ''];
  const host = String(ref || '').trim().toLowerCase().replace(/^www\./, '').slice(0, 80);
  if (!host || host === 'medivasc.in') return ['direct', ''];
  if (/^mail\.google\./.test(host)) return ['other', host];
  for (const [bucket, pattern] of HOSTS) if (pattern.test(host)) return [bucket, ''];
  return ['other', host];
};

const device = (ua) => (/iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop');
const istDay = (ms = Date.now()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const clip = (value, max) => String(value || '').slice(0, max);

const allowedAdminOrigin = (origin, env) => SITE_ORIGINS.has(origin) || (env.ALLOW_LOCAL === '1' && LOCAL_ORIGIN.test(origin));

const cors = (origin, env) => (allowedAdminOrigin(origin, env)
  ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
  : { Vary: 'Origin' });

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
  const kind = body && KINDS.has(body.k) ? body.k : null; // body may be JSON null
  if (!kind) return new Response(null, { status: 204 });
  const [source, ref] = classify(body.u, body.r, ua);
  const cf = request.cf || {};
  await env.DB.prepare(
    `INSERT INTO daily (day, kind, source, ref, device, country, region, city, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
     ON CONFLICT (day, kind, source, ref, device, country, region, city) DO UPDATE SET n = n + 1`,
  ).bind(istDay(), kind, source, ref, device(ua), clip(cf.country, 2), clip(cf.region, 60), clip(cf.city, 60)).run();
  return new Response(null, { status: 204 });
}

// token-hash -> expiry (ms). Per isolate; a cold isolate just re-checks GitHub.
const verified = new Map();
const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

async function canPublish(token) {
  const key = await sha256(token);
  if ((verified.get(key) || 0) > Date.now()) return true;
  const gh = (path) => fetch('https://api.github.com' + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'medivasc-api', 'X-GitHub-Api-Version': '2022-11-28' },
  });
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

async function stats(request, env, url) {
  const origin = request.headers.get('Origin') || '';
  const headers = cors(origin, env);
  if (!allowedAdminOrigin(origin, env)) return json({ error: 'origin' }, 403, headers);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const authorised = env.ALLOW_LOCAL === '1' || (token && (await canPublish(token)));
  if (!authorised) return json({ error: 'unauthorised' }, 401, headers);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const to = day.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : istDay();
  const from = day.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : '2000-01-01';
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/p' && request.method === 'POST') return collect(request, env);
    if (url.pathname === '/s') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request.headers.get('Origin') || '', env) });
      if (request.method === 'GET') return stats(request, env, url);
    }
    return new Response('Not found', { status: 404 });
  },
};
