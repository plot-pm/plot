// Contract test for the request count of plot-host.sh's Bitbucket listings and
// for the `fields` filter they send. A stub `bb` answers `bb api …/pullrequests`
// the way Bitbucket does: the rows whose state and branch the query names,
// 50 a page with a `next`, pruned to the paths the `fields` parameter names.
// Each invocation is one request and appends one line to the calls file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapter = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-host.sh');
const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

const temps = [];
process.on('exit', () => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const STUB = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('bb version 1.9.0'); process.exit(0); }
if (args.includes('--help')) { console.log('bb pr list help'); process.exit(0); }
fs.appendFileSync(process.env.STUB_CALLS, args.join(' ') + '\n');
const at = args.indexOf('api');
if (at === -1) { console.error('stub: only bb api is served'); process.exit(9); }
const [route, query = ''] = args[at + 1].split('?');
if (!route.endsWith('/pullrequests')) { console.log('{}'); process.exit(0); }
const params = query.split('&').map((pair) => pair.split('=')).map(([key, ...rest]) => [key, rest.join('=')]);
const param = (key) => params.filter(([name]) => name === key).map(([, value]) => decodeURIComponent(value));
const q = param('q')[0] ?? '';
const states = q === '' ? param('state') : [...q.matchAll(/state="(\w+)"/g)].map((match) => match[1]);
const branch = q.match(/source\.branch\.name="([^"]*)"/)?.[1] ?? null;
const pagelen = Math.min(Number(param('pagelen')[0] ?? 10), 50);
const page = Number(param('page')[0] ?? 1);
const fields = (param('fields')[0] ?? '').split(',').filter(Boolean);
const rows = JSON.parse(fs.readFileSync(process.env.STUB_ROWS, 'utf8'))
  .filter((row) => states.includes(row.state) && (branch === null || row.source.branch.name === branch))
  .sort((a, b) => b.updated_on.localeCompare(a.updated_on));
const envelope = { pagelen, size: rows.length, page, values: rows.slice((page - 1) * pagelen, page * pagelen) };
if (rows.length > page * pagelen) {
  envelope.next = 'https://api.bitbucket.org/2.0' + route + '?' + query.replace(/&page=\d+/, '') + '&page=' + (page + 1);
}
const prune = (value, paths) => {
  const kept = {};
  for (const key of Object.keys(value)) {
    if (paths.includes(key)) { kept[key] = value[key]; continue; }
    const inner = paths.filter((p) => p.startsWith(key + '.')).map((p) => p.slice(key.length + 1));
    if (inner.length === 0) continue;
    const child = value[key];
    if (Array.isArray(child)) kept[key] = child.map((item) => prune(item, inner));
    else if (child !== null && typeof child === 'object') kept[key] = prune(child, inner);
  }
  return kept;
};
process.stdout.write(JSON.stringify(fields.length === 0 || process.env.STUB_NO_PRUNE ? envelope : prune(envelope, fields)));
`;

const makeBb = (rows) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-bb-requests-'));
  temps.push(dir);
  writeFileSync(path.join(dir, 'bb'), STUB);
  chmodSync(path.join(dir, 'bb'), 0o755);
  // `git fetch` is refused, so no case reaches the network or moves this checkout's refs.
  writeFileSync(path.join(dir, 'git'), `#!/usr/bin/env bash\n[ "$1" = fetch ] && { echo 'fatal: offline' >&2; exit 128; }\nexec "${realGit}" "$@"\n`);
  chmodSync(path.join(dir, 'git'), 0o755);
  writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows));
  return dir;
};

const ask = (dir, args, env = {}) => {
  const calls = path.join(dir, 'bb.calls');
  rmSync(calls, { force: true });
  const res = spawnSync('bash', [adapter, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PLOT_HOST: 'bitbucket',
      PLOT_BUDGET_HOME: path.join(dir, 'budget-home'),
      STUB_CALLS: calls,
      STUB_ROWS: path.join(dir, 'rows.json'),
      ...env,
    },
  });
  const requests = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter((line) => / api /.test(` ${line} `)) : [];
  return { ...res, requests };
};

const STATES = ['OPEN', 'MERGED', 'DECLINED'];

/** `count` pull requests, one branch each, cycling through the three states, every field a projection reads set. */
const pullRequests = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `PR ${i + 1}`,
    state: STATES[i % 3],
    draft: i % 2 === 0,
    updated_on: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T12:${String(i % 60).padStart(2, '0')}:00.000000+00:00`,
    created_on: '2026-10-01T00:00:00.000000+00:00',
    description: 'read by no projection',
    links: { html: { href: `https://bitbucket.org/ws/repo/pull-requests/${i + 1}` } },
    author: { nickname: `author-${i % 4}`, display_name: 'read by no projection' },
    source: { branch: { name: `feature/pr-${i + 1}` }, commit: { hash: `${String(i).padStart(4, '0')}abcdef12` } },
    destination: { branch: { name: 'main' } },
    merge_commit: i % 3 === 1 ? { hash: `merge${i}` } : null,
  }));

for (const [rows, requests] of [[0, 1], [50, 1], [51, 2], [120, 3]]) {
  test(`bitbucket: pr-list --state all over ${rows} pull requests sends ${requests} request(s)`, () => {
    const dir = makeBb(pullRequests(rows));
    const res = ask(dir, ['pr-list', '--state', 'all', '--limit', '3000']);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.split('\n').filter(Boolean).length, rows);
    assert.equal(res.requests.length, requests, res.requests.join('\n'));
  });
}

test('bitbucket: pr-list --state all --branch × 53 sends 53 requests, one per branch for every state', () => {
  const prs = pullRequests(60);
  const dir = makeBb(prs);
  const branches = prs.slice(0, 53).flatMap((pr) => ['--branch', pr.source.branch.name]);
  const res = ask(dir, ['pr-list', '--state', 'all', ...branches]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.requests.length, 53, 'one request per branch, not one per branch and state');
  assert.equal(res.stdout.split('\n').filter(Boolean).length, 53);
});

test('bitbucket: pr-state sends one request', () => {
  const dir = makeBb(pullRequests(6));
  const res = ask(dir, ['pr-state', 'feature/pr-2']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.requests.length, 1);
});

// A field the projection reads and the filter omits arrives missing and reads
// as empty. Each case asks the same question with the stub pruning to the
// filter and with the stub answering every field, and the two outputs must
// be equal.
for (const args of [
  ['pr-list', '--state', 'all', '--limit', '3000'],
  ['pr-list', '--state', 'all', '--branch', 'feature/pr-2', '--branch', 'feature/pr-3'],
  ['pr-list', '--state', 'merged', '--since', '2026-11-01T00:00:00Z'],
  ['pr-list', '--state', 'all', '--rich', '--limit', '3000'],
  ['pr-state', 'feature/pr-2'],
  ['pr-state', 'feature/pr-3'],
]) {
  test(`bitbucket: the fields filter holds every field ${args.join(' ')} projects`, () => {
    const dir = makeBb(pullRequests(9));
    const pruned = ask(dir, args);
    const whole = ask(dir, args, { STUB_NO_PRUNE: '1' });
    assert.equal(pruned.status, 0, pruned.stderr);
    assert.equal(whole.status, 0, whole.stderr);
    assert.ok(pruned.requests.every((line) => line.includes('fields=')), 'every listing request sends a fields filter');
    assert.notEqual(pruned.stdout.trim(), '');
    assert.equal(pruned.stdout, whole.stdout);
  });
}
