-- Blog: private drafts + anonymous per-page reading counts. Additive and idempotent
-- (IF NOT EXISTS), so it is safe to run twice. Apply after schema.sql, from traffic/:
--   local:  npx wrangler d1 execute medivasc-traffic --local --file migrations/0002_blog.sql
--   live:   npx wrangler d1 execute medivasc-traffic --remote --file migrations/0002_blog.sql
--           (an owner-approved ship step, BEFORE deploying the worker that reads them)

-- One row per draft. json = the whole post object the admin editor saves (<= 900 KB);
-- slug and title are copied out of it so the list never has to read json.
-- updated_at (ms since epoch) is the version tag the admin sends back as If-Match.
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

-- A draft's images (cover, inline photos) until it is published. bytes <= 1.9 MB,
-- because D1 caps one row at 2,000,000 bytes. Deleting a draft deletes these too
-- (the worker does it in the same batch).
CREATE TABLE IF NOT EXISTS draft_assets (
  draft_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (draft_id, name)
);

-- Per (IST day, blog page) reading counts; no visitor data, like `daily`.
-- path = 'blog/', 'blog/<slug>/', 'blog/category/<slug>/'… (no /changes/, no index.html).
-- visits = first view of that page in a tab session; enquiries = the visit's first
-- WhatsApp/call/email tap, credited only when that tap happens ON a blog page (a tap on
-- the homepage after reading a post is not credited to the post; owner call if wanted).
CREATE TABLE IF NOT EXISTS blog_daily (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  enquiries INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
