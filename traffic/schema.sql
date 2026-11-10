-- One row per (IST day, kind, source, ref, device, country, region, city); n = count.
-- kind: v = visit, w = WhatsApp tap, c = call tap, e = email tap.
-- ref is only set for source = 'other' (the referring host, or "tag: <utm_source>").
CREATE TABLE IF NOT EXISTS daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  city TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, source, ref, device, country, region, city)
);
