#!/usr/bin/env node
// Scheduled-post trigger for .github/workflows/blog-schedule.yml.
//
//   node tools/blog-due.js --last-deploy <iso> [--now <iso>] [--file data/blog/posts.json]
//
// A post is DUE when it is live (status published|scheduled, not a sample) AND its
// publishAt <= now AND publishAt > lastDeployStart. The build only includes posts
// whose time has come, so a post that came due after the last deploy STARTED was
// left out of that build and needs a fresh deploy. The deploy's start is used
// regardless of its outcome: a failing deploy therefore cannot loop the scheduler
// (the next tick sees a newer start and finds nothing due).
//
// `--last-deploy` is required (the workflow reads it from `gh run list`). The epoch
// (1970-01-01T00:00:00Z) means "no deploy on record": then only posts that came due
// in the last 24 hours count, so a repo with no deploy history does not treat every
// old post as new.
//
// Output: the due ids, one per line (or a "nothing due" note), and — when
// $GITHUB_OUTPUT is set — `due=true|false` and `ids=<comma list>` appended to it.
// Exit 0 whenever the check ran (a missing, empty or unreadable posts file is
// "nothing due", with a warning); exit 2 on bad arguments.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LIVE = new Set(['published', 'scheduled']);
const NO_DEPLOY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'blog', 'posts.json');

// Strict-ish ISO 8601: a date, a time, and an explicit zone (Z or ±hh:mm). A
// zone-less time would be read in the runner's local zone, so it is rejected.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const timeOf = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || !ISO.test(value.trim())) return null;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? null : ms;
};

// Pure: posts (any JSON), now + lastDeployStart (Date | ISO string) → due ids.
const dueIds = (posts, now, lastDeployStart) => {
  const nowMs = timeOf(now);
  let sinceMs = timeOf(lastDeployStart);
  if (nowMs === null) throw new Error(`blog-due: invalid "now": ${now}`);
  if (sinceMs === null) throw new Error(`blog-due: invalid last deploy start: ${lastDeployStart}`);
  if (sinceMs === 0) sinceMs = nowMs - NO_DEPLOY_WINDOW_MS;
  if (!Array.isArray(posts)) return [];
  return posts
    .filter((post) => post && typeof post === 'object' && !post.sample && LIVE.has(post.status))
    .map((post) => ({ id: typeof post.id === 'string' && post.id ? post.id : String(post.slug || ''), at: timeOf(post.publishAt) }))
    .filter(({ id, at }) => id && at !== null && at <= nowMs && at > sinceMs)
    .sort((a, b) => a.at - b.at)
    .map(({ id }) => id);
};

// File → posts array; never throws (the scheduler must not fail every 15 minutes
// because of a content problem the deploy build already reports).
const readPosts = (file) => {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { posts: [], note: `no ${file} — nothing to schedule` };
    return { posts: [], warning: `could not read ${file}: ${error.message}` };
  }
  if (!raw.trim()) return { posts: [], note: `${file} is empty — nothing to schedule` };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { posts: [], warning: `${file} is not a JSON array` };
    return { posts: parsed };
  } catch (error) {
    return { posts: [], warning: `${file} is not valid JSON (${error.message})` };
  }
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const m = /^--(now|last-deploy|file)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`unknown argument "${arg}"`);
    const value = m[2] !== undefined ? m[2] : argv[(i += 1)];
    if (value === undefined) throw new Error(`--${m[1]} needs a value`);
    args[m[1]] = value;
  }
  return args;
};

const USAGE = 'usage: node tools/blog-due.js --last-deploy <iso> [--now <iso>] [--file <posts.json>]';

const main = (argv = process.argv.slice(2), env = process.env, out = console) => {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    out.error(`blog-due: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (!args['last-deploy']) {
    out.error(`blog-due: --last-deploy is required\n${USAGE}`);
    return 2;
  }
  const now = args.now || new Date().toISOString();
  if (timeOf(now) === null || timeOf(args['last-deploy']) === null) {
    out.error(`blog-due: --now / --last-deploy must be ISO 8601 with a zone (e.g. 2026-11-20T09:00:00+05:30 or …Z)\n${USAGE}`);
    return 2;
  }
  const file = path.resolve(args.file || DEFAULT_FILE);
  const { posts, note, warning } = readPosts(file);
  if (warning) out.log(`::warning::blog-due: ${warning}; nothing scheduled this tick.`);
  else if (note) out.log(`blog-due: ${note}`);
  const ids = dueIds(posts, now, args['last-deploy']);
  out.log(ids.length ? `Due since ${args['last-deploy']}:\n${ids.join('\n')}` : `blog-due: nothing due (now ${now}, last deploy ${args['last-deploy']}).`);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `due=${ids.length ? 'true' : 'false'}\nids=${ids.join(',')}\n`);
  return 0;
};

if (require.main === module) process.exitCode = main();

module.exports = { dueIds, readPosts, main, NO_DEPLOY_WINDOW_MS };
