#!/usr/bin/env node
/**
 * Records the fixtures `bitbucket-pr-listing.corpus.test.ts` reads.
 *
 * For each case it runs `plot-host.sh pr-list` with a stub `bb` on `PATH`.
 * The stub answers `bb api <path>` from a generated dataset the way
 * Bitbucket Cloud pages it: `pagelen` rows a page, a `size` of all matches,
 * and a `next` link on the base `https://api.bitbucket.org/2.0` until the
 * last page. The recorder writes, per case:
 *
 * - `calls`: every `bb` argv `plot-host.sh` ran and the stdout the stub printed.
 *   The corpus serves these to `plot-host.sh` through a stub `bb`.
 * - `exchanges`: every request path the stub served, with `{ws}` and `{repo}`
 *   unresolved, and the page it answered. The corpus serves these to the
 *   in-process adapter over a stub HTTP server.
 *
 * It makes no network call and reads no credential. The checkout it runs in
 * has an `origin` that no `git fetch` can reach, so every open row reads
 * `mergeable: unknown` with the failed-fetch reason on both sides.
 *
 * Usage: node packages/domain/corpus/record-bitbucket-pr-listing.mjs [case ...]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const OUT = join(ROOT, 'packages/domain/corpus/fixtures/bitbucket-pr-listing');
const SLUG = 'plot-fixture/listing';
const BASE = 'https://api.bitbucket.org/2.0';

const sha = (n) => {
  let s = '';
  for (let i = 0; s.length < 40; i += 1) s += ((n * 2654435761 + i * 40503) >>> 0).toString(16);
  return s.slice(0, 40);
};
const stamp = (n) => new Date(Date.UTC(2026, 9, 1) + n * 3_600_000).toISOString().replace('Z', '123+00:00').replace('.000', '.');

/** One pull request as Bitbucket's `pullrequests` endpoint answers it. */
const pr = (id, state) => {
  const row = {
    type: 'pullrequest',
    id,
    title: `Change ${id}${id % 9 === 0 ? ' "quoted" & <tagged>' : ''}`,
    state,
    draft: state === 'OPEN' && id % 7 === 0 ? true : id % 5 === 0 ? false : undefined,
    updated_on: stamp(id),
    links: id % 13 === 0 ? {} : { html: { href: `https://bitbucket.org/${SLUG}/pull-requests/${id}` } },
    author: id % 11 === 0 ? null : { nickname: `dev${id % 4}`, display_name: `Dev ${id % 4}` },
    source: { branch: { name: id % 17 === 0 ? `feature/ünïcode-${id}` : `feature/change-${id}` }, commit: id % 19 === 0 ? null : { hash: sha(id) } },
    destination: id % 23 === 0 ? { branch: null } : { branch: { name: id % 3 === 0 ? 'develop' : 'main' } },
  };
  return JSON.parse(JSON.stringify(row));
};
const range = (from, count, state) => Array.from({ length: count }, (_, i) => pr(from + i, state));
const DATASET = [...range(1, 9, 'OPEN'), ...range(100, 130, 'MERGED'), ...range(300, 5, 'DECLINED')];
// Two more rows on one branch, so a sweep over it holds several rows.
DATASET.push({ ...pr(400, 'MERGED'), source: { branch: { name: 'feature/change-5' }, commit: { hash: sha(400) } } });
DATASET.push({ ...pr(401, 'DECLINED'), source: { branch: { name: 'feature/change-5' }, commit: { hash: sha(401) } } });

/** The cases: a name, the query the port is asked, and the `plot-host.sh` arguments. */
const CASES = [
  { name: 'open-plain-no-limit', query: { state: 'open' }, args: ['--state', 'open'] },
  { name: 'open-plain-limit', query: { state: 'open', limit: 100 }, args: ['--state', 'open', '--limit', '100'] },
  { name: 'open-plain-limit-below-rows', query: { state: 'open', limit: 4 }, args: ['--state', 'open', '--limit', '4'] },
  { name: 'merged-plain-three-pages', query: { state: 'merged', limit: 200 }, args: ['--state', 'merged', '--limit', '200'] },
  { name: 'merged-plain-trimmed', query: { state: 'merged', limit: 120 }, args: ['--state', 'merged', '--limit', '120'] },
  { name: 'all-plain-limit', query: { state: 'all', limit: 200 }, args: ['--state', 'all', '--limit', '200'] },
  { name: 'all-plain-no-limit', query: { state: 'all' }, args: ['--state', 'all'] },
  { name: 'all-rich', query: { state: 'all', rich: true, limit: 200 }, args: ['--rich', '--state', 'all', '--limit', '200'] },
  { name: 'open-rich-open', query: { state: 'open', richOpen: true, limit: 50 }, args: ['--rich-open', '--state', 'open', '--limit', '50'] },
  { name: 'declined-plain', query: { state: 'closed', limit: 50 }, args: ['--state', 'closed', '--limit', '50'] },
  { name: 'merged-window', query: { state: 'merged', since: stamp(150).replace('+00:00', 'Z').slice(0, 19) + 'Z' }, args: ['--state', 'merged', '--since', stamp(150).replace('+00:00', 'Z').slice(0, 19) + 'Z'] },
  { name: 'all-window-rich', query: { state: 'all', rich: true, since: '2026-10-01T00:00:00Z' }, args: ['--rich', '--state', 'all', '--since', '2026-10-01T00:00:00Z'] },
  { name: 'sweep-plain', query: { state: 'all', branches: ['feature/change-5', 'feature/change-2', 'feature/ünïcode-17'] }, args: ['--state', 'all', '--branch', 'feature/change-5', '--branch', 'feature/change-2', '--branch', 'feature/ünïcode-17'] },
  { name: 'sweep-rich', query: { state: 'open', rich: true, branches: ['feature/change-3', 'feature/change-7'] }, args: ['--rich', '--state', 'open', '--branch', 'feature/change-3', '--branch', 'feature/change-7'] },
  { name: 'sweep-window', query: { state: 'merged', since: '2026-10-05T00:00:00Z', branches: ['feature/change-5', 'feature/change-120'] }, args: ['--state', 'merged', '--since', '2026-10-05T00:00:00Z', '--branch', 'feature/change-5', '--branch', 'feature/change-120'] },
];
// `closed` is the shell's word for DECLINED; the port asks `all`, `open` or `merged`, so drop the case the port cannot ask.
CASES.splice(CASES.findIndex((one) => one.name === 'declined-plain'), 1);

/** The stub `bb`: answers `bb api <path>` from the dataset and appends each exchange to a log. */
const STUB = String.raw`
import { appendFileSync, readFileSync } from 'node:fs';
const [data, log, ...argv] = process.argv.slice(2);
const dataset = JSON.parse(readFileSync(data, 'utf8'));
const at = argv.indexOf('api');
if (at === -1) { console.error('stub bb: only api is answered'); process.exit(1); }
const path = argv[at + 1];
const url = new URL('https://x' + path);
const q = url.searchParams.get('q');
let state = url.searchParams.get('state');
let branch = null;
let since = null;
if (q !== null) {
  state = /state="(\w+)"/.exec(q)?.[1] ?? null;
  branch = /source\.branch\.name="([^"]*)"/.exec(q)?.[1] ?? null;
  since = /updated_on>="([^"]*)"/.exec(q)?.[1] ?? null;
}
const pagelen = Number(url.searchParams.get('pagelen') ?? 10);
const page = Number(url.searchParams.get('page') ?? 1);
const matches = dataset
  .filter((row) => state === null || row.state === state)
  .filter((row) => branch === null || row.source.branch.name === branch)
  .filter((row) => since === null || row.updated_on >= since)
  .sort((a, b) => (a.updated_on < b.updated_on ? 1 : -1));
const values = matches.slice((page - 1) * pagelen, page * pagelen);
const body = { pagelen, page, size: matches.length, values };
if (page * pagelen < matches.length) {
  const raw = path.replace('{ws}/{repo}', ${JSON.stringify(SLUG)}).replace(/&page=\d+/, '');
  body.next = ${JSON.stringify(BASE)} + raw + '&page=' + (page + 1);
}
const stdout = JSON.stringify(body);
appendFileSync(log, JSON.stringify({ argv, path, stdout }) + '\n');
process.stdout.write(stdout);
`;

const only = process.argv.slice(2);
const work = mkdtempSync(join(tmpdir(), 'plot-bitbucket-record-'));
try {
  const bin = join(work, 'bin');
  mkdirSync(bin);
  writeFileSync(join(work, 'dataset.json'), JSON.stringify(DATASET));
  writeFileSync(join(work, 'stub.mjs'), STUB);
  const repo = join(work, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', join(work, 'no-such-origin.git')], { cwd: repo });
  mkdirSync(OUT, { recursive: true });
  for (const one of CASES.filter((c) => only.length === 0 || only.includes(c.name))) {
    const log = join(work, `${one.name}.log`);
    writeFileSync(log, '');
    writeFileSync(join(bin, 'bb'), `#!/usr/bin/env bash\nexec node ${JSON.stringify(join(work, 'stub.mjs'))} ${JSON.stringify(join(work, 'dataset.json'))} ${JSON.stringify(log)} "$@"\n`);
    chmodSync(join(bin, 'bb'), 0o755);
    const ran = spawnSync('bash', [HOST, 'pr-list', ...one.args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PLOT_HOST: 'bitbucket', PLOT_CI: 'github-actions', PLOT_BUDGET_OFF: '1', PLOT_BB_SKIP_CAP_CHECK: '1' },
    });
    if (ran.status !== 0) throw new Error(`${one.name}: plot-host.sh exited ${ran.status}\n${ran.stderr}`);
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const unresolved = (p) => p.replace(`/repositories/${SLUG}/`, '/repositories/{ws}/{repo}/');
    const fixture = {
      query: one.query,
      args: one.args,
      calls: lines.map((l) => ({ argv: l.argv, stdout: l.stdout })),
      exchanges: lines.map((l) => ({ path: unresolved(l.path), response: JSON.parse(l.stdout) })),
    };
    writeFileSync(join(OUT, `${one.name}.json`), `${JSON.stringify(fixture, null, 1)}\n`);
    console.log(`${one.name}: ${lines.length} calls, ${ran.stdout.split('\n').filter(Boolean).length} rows`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
