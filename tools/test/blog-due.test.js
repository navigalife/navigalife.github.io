#!/usr/bin/env node
// Scheduler due-check tests (plain node; exits non-zero on failure).
//   node tools/test/blog-due.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'tools', 'blog-due.js');
const { dueIds, readPosts, main, NO_DEPLOY_WINDOW_MS } = require(CLI);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-due-'));

const post = (id, publishAt, extra = {}) => ({ id, slug: id.replace(/^p_/, ''), status: 'scheduled', publishAt, title: id, ...extra });
const LAST = '2026-11-20T03:00:00Z'; // last deploy started 08:30 IST
const NOW = '2026-11-20T03:30:00Z'; // this tick, 09:00 IST

test('due: published|scheduled, last deploy < publishAt <= now', () => {
  const posts = [
    post('p_before', '2026-11-20T02:59:59Z'), // in the last build already
    post('p_due', '2026-11-20T03:15:00Z'),
    post('p_pub', '2026-11-20T03:20:00Z', { status: 'published' }),
    post('p_future', '2026-11-20T03:30:01Z'),
  ];
  assert.deepEqual(dueIds(posts, NOW, LAST), ['p_due', 'p_pub']);
});

test('boundaries: publishAt == last deploy start is NOT due; publishAt == now IS due', () => {
  assert.deepEqual(dueIds([post('p_edge', LAST)], NOW, LAST), []);
  assert.deepEqual(dueIds([post('p_edge', NOW)], NOW, LAST), ['p_edge']);
  assert.deepEqual(dueIds([post('p_ms', '2026-11-20T03:00:00.001Z')], NOW, LAST), ['p_ms']);
  // now == last deploy: an empty window.
  assert.deepEqual(dueIds([post('p_x', LAST)], LAST, LAST), []);
});

test('time zones: +05:30 and Z compare as instants', () => {
  // 08:30 IST == 03:00Z == the deploy start → not due; 08:31 IST → due; 09:00:01 IST → future.
  assert.deepEqual(dueIds([post('p_a', '2026-11-20T08:30:00+05:30')], NOW, LAST), []);
  assert.deepEqual(dueIds([post('p_b', '2026-11-20T08:31:00+05:30')], NOW, LAST), ['p_b']);
  assert.deepEqual(dueIds([post('p_c', '2026-11-20T09:00:00+05:30')], NOW, LAST), ['p_c'], '09:00 IST == now');
  assert.deepEqual(dueIds([post('p_d', '2026-11-20T09:00:01+05:30')], NOW, LAST), []);
  // The clock and the deploy start may carry offsets too.
  assert.deepEqual(dueIds([post('p_e', '2026-11-20T03:10:00Z')], '2026-11-20T09:00:00+05:30', '2026-11-20T08:30:00+05:30'), ['p_e']);
  // Across midnight UTC (IST is already the next day).
  assert.deepEqual(dueIds([post('p_f', '2026-11-21T05:00:00+05:30')], '2026-11-20T23:45:00Z', '2026-11-20T23:15:00Z'), ['p_f']);
  // Date objects work as well as strings.
  assert.deepEqual(dueIds([post('p_g', '2026-11-20T03:15:00Z')], new Date(NOW), new Date(LAST)), ['p_g']);
});

test('ignored: unpublished, samples, unknown status, drafts', () => {
  const posts = [
    post('p_unpub', '2026-11-20T03:15:00Z', { status: 'unpublished' }),
    post('p_sample', '2026-11-20T03:15:00Z', { sample: true }),
    post('p_draft', '2026-11-20T03:15:00Z', { status: 'draft' }),
    post('p_nostatus', '2026-11-20T03:15:00Z', { status: undefined }),
    post('p_ok', '2026-11-20T03:15:00Z'),
  ];
  assert.deepEqual(dueIds(posts, NOW, LAST), ['p_ok']);
});

test('malformed dates and entries are skipped safely', () => {
  const posts = [
    post('p_junk', 'next tuesday'),
    post('p_nozone', '2026-11-20T03:15:00'), // zone-less: ambiguous, never guessed
    post('p_dateonly', '2026-11-20'),
    post('p_badday', '2026-02-30T03:15:00Z'),
    post('p_num', 1795145400000),
    post('p_null', null),
    null, 42, 'p_string', [],
    { status: 'scheduled', publishAt: '2026-11-20T03:15:00Z' }, // no id or slug
    post('p_ok', '2026-11-20T03:15:00+00:00'),
  ];
  assert.deepEqual(dueIds(posts, NOW, LAST), ['p_ok']);
  assert.deepEqual(dueIds({ not: 'an array' }, NOW, LAST), []);
  assert.deepEqual(dueIds(null, NOW, LAST), []);
  assert.throws(() => dueIds([], 'soon', LAST), /invalid "now"/);
  assert.throws(() => dueIds([], NOW, ''), /invalid last deploy/);
});

test('due ids come out oldest first; id falls back to the slug', () => {
  const posts = [post('p_late', '2026-11-20T03:25:00Z'), { slug: 'slug-only', status: 'published', publishAt: '2026-11-20T03:05:00Z' }];
  assert.deepEqual(dueIds(posts, NOW, LAST), ['slug-only', 'p_late']);
});

test('no deploy on record (epoch 0): only the last 24 hours count', () => {
  const epoch = '1970-01-01T00:00:00Z';
  const posts = [
    post('p_old', '2026-11-01T03:00:00Z', { status: 'published' }),
    post('p_edge', new Date(Date.parse(NOW) - NO_DEPLOY_WINDOW_MS).toISOString()), // exactly 24h → excluded
    post('p_recent', '2026-11-19T12:00:00Z'),
  ];
  assert.deepEqual(dueIds(posts, NOW, epoch), ['p_recent']);
  // A real (if ancient) deploy start is NOT capped.
  assert.deepEqual(dueIds(posts, NOW, '2020-01-01T00:00:00Z'), ['p_old', 'p_edge', 'p_recent']);
});

test('readPosts: empty file, missing file, invalid JSON, non-array → no posts, no throw', () => {
  const empty = path.join(tmp, 'empty.json');
  fs.writeFileSync(empty, '  \n');
  assert.deepEqual(readPosts(empty).posts, []);
  assert.match(readPosts(empty).note, /empty/);
  assert.deepEqual(readPosts(path.join(tmp, 'missing.json')).posts, []);
  assert.match(readPosts(path.join(tmp, 'missing.json')).note, /no /);
  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, '[{"id": "p_1",');
  assert.deepEqual(readPosts(bad).posts, []);
  assert.match(readPosts(bad).warning, /not valid JSON/);
  const obj = path.join(tmp, 'obj.json');
  fs.writeFileSync(obj, '{"posts": []}');
  assert.match(readPosts(obj).warning, /not a JSON array/);
  const ok = path.join(tmp, 'ok.json');
  fs.writeFileSync(ok, JSON.stringify([post('p_1', NOW)]));
  assert.equal(readPosts(ok).posts.length, 1);
});

// CLI end to end (child process, real $GITHUB_OUTPUT file).
const run = (args, { output } = {}) => {
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  if (output) env.GITHUB_OUTPUT = output;
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { code: error.status, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') };
  }
};

test('CLI: prints due ids and writes due=true to $GITHUB_OUTPUT', () => {
  const file = path.join(tmp, 'posts.json');
  fs.writeFileSync(file, JSON.stringify([post('p_due', '2026-11-20T08:45:00+05:30'), post('p_two', '2026-11-20T03:20:00Z', { status: 'published' }), post('p_future', '2026-11-21T09:00:00+05:30')]));
  const output = path.join(tmp, 'out-true.txt');
  fs.writeFileSync(output, 'earlier=line\n');
  const result = run(['--now', NOW, '--last-deploy', LAST, '--file', file], { output });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /p_due\np_two/);
  assert.doesNotMatch(result.stdout, /p_future/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'earlier=line\ndue=true\nids=p_due,p_two\n', 'appends, never truncates');
});

test('CLI: nothing due → due=false; --flag=value form works', () => {
  const file = path.join(tmp, 'posts.json');
  const output = path.join(tmp, 'out-false.txt');
  const result = run([`--now=${NOW}`, '--last-deploy=2026-11-20T03:25:00Z', `--file=${file}`], { output });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /nothing due/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'due=false\nids=\n');
});

test('CLI: missing / empty / invalid posts file → due=false, exit 0', () => {
  for (const [name, content] of [['missing', null], ['empty', ''], ['invalid', '{oops']]) {
    const file = path.join(tmp, `cli-${name}.json`);
    if (content !== null) fs.writeFileSync(file, content);
    const output = path.join(tmp, `out-${name}.txt`);
    const result = run(['--now', NOW, '--last-deploy', LAST, '--file', file], { output });
    assert.equal(result.code, 0, `${name}: exit 0`);
    assert.equal(fs.readFileSync(output, 'utf8'), 'due=false\nids=\n', `${name}: due=false`);
    if (name === 'invalid') assert.match(result.stdout, /::warning::/);
  }
});

test('CLI: works without $GITHUB_OUTPUT; bad arguments exit 2', () => {
  const file = path.join(tmp, 'posts.json');
  assert.equal(run(['--now', NOW, '--last-deploy', LAST, '--file', file]).code, 0);
  assert.equal(run(['--now', NOW, '--file', file]).code, 2, '--last-deploy is required');
  assert.equal(run(['--last-deploy', 'yesterday', '--file', file]).code, 2);
  assert.equal(run(['--last-deploy', '2026-11-20T03:00:00', '--file', file]).code, 2, 'zone-less rejected');
  assert.equal(run(['--last-deploy', LAST, '--bogus']).code, 2);
  assert.equal(run(['--last-deploy']).code, 2);
});

test('CLI: --now defaults to the clock', () => {
  const file = path.join(tmp, 'clock.json');
  const soon = new Date(Date.now() - 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify([post('p_now', soon), post('p_later', new Date(Date.now() + 3600 * 1000).toISOString())]));
  const output = path.join(tmp, 'out-clock.txt');
  const result = run(['--last-deploy', new Date(Date.now() - 10 * 60 * 1000).toISOString(), '--file', file], { output });
  assert.equal(result.code, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), 'due=true\nids=p_now\n');
});

test('main(): in-process call with an injected logger', () => {
  const lines = [];
  const logger = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
  assert.equal(main(['--now', NOW, '--last-deploy', LAST, '--file', path.join(tmp, 'nope.json')], {}, logger), 0);
  assert.ok(lines.some((l) => /nothing due/.test(l)));
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}\n     ${String(error && error.stack || error).split('\n').slice(0, 4).join('\n     ')}`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
