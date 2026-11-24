// Contract test for the budget row of a refused `bb` call. `bb` exits 75 for a
// 429 the host sent and for two refusals that send no request: the hourly
// ceiling and the pause after an earlier 429. Only the first spends a request,
// so only the first writes a `budget.tsv` row. A stub `bb` exits with a chosen
// code and prints a chosen stderr; `pr-state 5` makes one `bb pr view` call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
if (args.includes('--version')) { console.log('bb version 1.15.0'); process.exit(0); }
fs.appendFileSync(process.env.STUB_CALLS, args.join(' ') + '\n');
process.stderr.write(process.env.STUB_ERR ?? '');
if (process.env.STUB_RC === '0') process.stdout.write('{}');
process.exit(Number(process.env.STUB_RC));
`;

const PAUSED = 'error: rate limited — bb paused until 10:45:23Z after Bitbucket refused a request (in 200 s)\n';
const CEILING = 'error: rate limited — 3 requests in the last hour from this machine; next request at 10:52:03Z (in 600 s)\n';
const HOST_429 = 'error: rate limited — Bitbucket asked to wait 30 s; bb paused until 10:47:03Z (in 300 s)\n';

/** Runs `pr-state 5` against a stub `bb` that exits `rc` with `stderr`; answers the rows written and the stub's calls. */
const askOnce = (rc, stderr) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-bb-refused-'));
  temps.push(dir);
  writeFileSync(path.join(dir, 'bb'), STUB);
  chmodSync(path.join(dir, 'bb'), 0o755);
  writeFileSync(path.join(dir, 'git'), `#!/usr/bin/env bash\n[ "$1" = fetch ] && { echo 'fatal: offline' >&2; exit 128; }\nexec "${realGit}" "$@"\n`);
  chmodSync(path.join(dir, 'git'), 0o755);
  const home = path.join(dir, 'budget-home');
  const calls = path.join(dir, 'bb.calls');
  const res = spawnSync('bash', [adapter, 'pr-state', '5'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PLOT_HOST: 'bitbucket',
      PLOT_BUDGET_HOME: home,
      PLOT_BUDGET_ACCOUNT: 'tester',
      STUB_CALLS: calls,
      STUB_RC: String(rc),
      STUB_ERR: stderr,
    },
  });
  const budget = path.join(home, 'budget.tsv');
  const rows = existsSync(budget) ? readFileSync(budget, 'utf8').split('\n').filter(Boolean) : [];
  const sent = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  return { ...res, rows, sent };
};

for (const [name, said] of [['the pause after an earlier 429', PAUSED], ['the hourly ceiling', CEILING]]) {
  test(`bb budget: exit 75 with ${name} writes no row`, () => {
    const res = askOnce(75, said);
    assert.equal(res.sent.length, 1, 'the stub was asked once');
    assert.deepEqual(res.rows, [], res.stderr);
  });

  test(`bb budget: the caller still reads ${name} on stderr`, () => {
    const res = askOnce(75, said);
    assert.ok(res.stderr.includes(said.trim()), res.stderr);
    assert.equal(res.status, 5, 'failed_code still maps 75 to 5');
  });
}

test('bb budget: exit 75 with a 429 the host sent writes one row', () => {
  const res = askOnce(75, HOST_429);
  assert.equal(res.rows.length, 1, res.stderr);
  assert.ok(res.stderr.includes('Bitbucket asked to wait 30 s'), res.stderr);
});

test('bb budget: a refusal phrase under any exit but 75 writes one row', () => {
  assert.equal(askOnce(1, PAUSED).rows.length, 1);
});

for (const rc of [0, 1]) {
  test(`bb budget: exit ${rc} writes one row`, () => {
    const res = askOnce(rc, rc === 0 ? '' : 'error: not found\n');
    assert.equal(res.sent.length, 1);
    assert.equal(res.rows.length, 1, res.stderr);
  });
}
