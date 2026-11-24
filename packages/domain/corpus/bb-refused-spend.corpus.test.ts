import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { bbThrottleCause } from '../src/rules/bb-ledger.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Does `bb_sent` in `plot-host.sh` answer what `bbThrottleCause` answers?
 *
 * `bb_sent` decides whether a `bb` call spent a request, from its exit code and
 * stderr: an exit 75 that names the hourly ceiling or a pause after an earlier
 * 429 sent none and writes no `budget.tsv` row. The rule's side of the same
 * answer is `bbThrottleCause(stderr) !== 'host'` under exit 75. The shell's side
 * is the row count a stub `bb` call leaves, read through `plot-host.sh pr-state`.
 *
 * The texts are every stderr `record-bb-ledger.mjs` recorded from `bb` 1.15.0
 * under exit 75, plus variants that change one word of a phrase.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const ADAPTER = path.join(ROOT, 'skills', 'plot', 'scripts', 'plot-host.sh');
const report = describingAs({ left: 'rule', right: 'shell' });

interface Outputs {
  readonly bb: string;
  readonly cases: readonly { name: string; status: number; stderr: string }[];
}

const outputs = JSON.parse(readFileSync(new URL('./fixtures/bb-ledger/bb-outputs.json', import.meta.url), 'utf8')) as Outputs;
const recorded = outputs.cases.filter((one) => one.status === 75).map((one) => ({ name: one.name, status: one.status, stderr: one.stderr }));

const VARIANTS = [
  { name: 'pause by another host', status: 75, stderr: 'error: rate limited — bb paused until 23:59:59Z after bitbucket.example.ch refused a request (in 5 s)\n' },
  { name: 'ceiling after rows', status: 75, stderr: 'error: rate limited after 50 rows — 800 requests in the last hour from this machine; next request at 00:00:01Z (in 3600 s)\n' },
  { name: 'pause with no host named', status: 75, stderr: 'error: rate limited — bb paused until 10:45:23Z (in 200 s)\n' },
  { name: 'ceiling words without its clause', status: 75, stderr: 'error: 3 requests in the last hour from this machine\n' },
  { name: 'a pause phrase under exit 1', status: 1, stderr: 'error: rate limited — bb paused until 10:45:23Z after Bitbucket refused a request (in 200 s)\n' },
  { name: 'a ceiling phrase under exit 0', status: 0, stderr: 'error: rate limited — 3 requests in the last hour from this machine; next request at 10:52:03Z (in 600 s)\n' },
];

const STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('bb version 1.15.0'); process.exit(0); }
process.stderr.write(process.env.STUB_ERR ?? '');
if (process.env.STUB_RC === '0') process.stdout.write('{}');
process.exit(Number(process.env.STUB_RC));
`;

const dir = mkdtempSync(path.join(tmpdir(), 'plot-bb-spend-corpus-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(path.join(dir, 'bb'), STUB);
chmodSync(path.join(dir, 'bb'), 0o755);

/** The rows one `bb` call left in a fresh budget home. */
const shellSpend = (status: number, stderr: string, at: number): number => {
  const home = path.join(dir, `home-${at}`);
  spawnSync('bash', [ADAPTER, 'pr-state', '5'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      PLOT_HOST: 'bitbucket',
      PLOT_BUDGET_HOME: home,
      PLOT_BUDGET_ACCOUNT: 'corpus',
      STUB_RC: String(status),
      STUB_ERR: stderr,
    },
  });
  const file = path.join(home, 'budget.tsv');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
};

const ruleSpend = (status: number, stderr: string): number => (status === 75 && bbThrottleCause(stderr) !== 'host' ? 0 : 1);

describe("bb_sent agrees with bbThrottleCause on a refused bb call's spend", () => {
  it('reads recordings of bb 1.15.0 that hold a ceiling, a pause and a sent 429, so this is not vacuous', () => {
    expect(outputs.bb.startsWith('bb 1.15.0 ')).toBe(true);
    const causes = recorded.map((one) => bbThrottleCause(one.stderr));
    expect(causes).toEqual(expect.arrayContaining(['ceiling', 'paused', 'host']));
  });

  it('writes a row exactly where the rule says a request went out', () => {
    const found: Disagreement[] = [];
    [...recorded, ...VARIANTS].forEach((one, at) => {
      compareField(found, `${one.name} (exit ${one.status})`, 'spend', ruleSpend(one.status, one.stderr), shellSpend(one.status, one.stderr, at));
    });
    expect(found.map(report)).toEqual([]);
  }, 120_000);
});
