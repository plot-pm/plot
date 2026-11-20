import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declaredHostLimit } from '../src/rules/declared-host-limit.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Does `declaredHostLimit` answer what `plot-host.sh`'s `budget_reading
 * bitbucket` answers as its limit?
 *
 * Each case runs the shell function with a stub `plot-config.sh` that prints
 * the case's value for the `Host rate limit` key, and asks the rule over the
 * same value.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const HOST = join(ROOT, 'skills/plot/scripts/plot-host.sh');
const report = describingAs({ left: 'rule', right: 'shell' });

const CASES: readonly string[] = ['', '10000', '2000', '1', '0', '010', '-5', '10,000', '10000/h', '1e4', 'many'];

let sandbox = '';
let shellValues: string[] = [];

/** The text of `budget_reading`, lifted from `plot-host.sh`. */
const shellFunction = (): string => {
  const run = spawnSync('awk', ['/^budget_reading\\(\\) \\{/{on=1} on{print} on&&/^\\}/{on=0}', HOST], { encoding: 'utf8' });
  if (run.status !== 0 || run.stdout === '') throw new Error(`could not lift budget_reading: ${run.stderr}`);
  return run.stdout;
};

/** The limit field of the shell's `budget_reading bitbucket` where the key holds `value`. */
const shellLimit = (value: string, index: number, text: string): string => {
  const here = join(sandbox, `case-${index}`);
  spawnSync('mkdir', ['-p', here]);
  const stub = join(here, 'plot-config.sh');
  writeFileSync(stub, `#!/usr/bin/env bash\n[ "$2" = "Host rate limit" ] && printf '%s\\n' "$PLOT_CASE_VALUE"\n`);
  chmodSync(stub, 0o755);
  const run = spawnSync('bash', ['-c', `here=${JSON.stringify(here)}\n${text}\nbudget_reading bitbucket`], {
    env: { ...process.env, PLOT_CASE_VALUE: value },
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (run.error) throw new Error(`budget_reading did not finish: ${run.error.message}`);
  return run.stdout.split('\t')[0] ?? '';
};

beforeAll(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'plot-declared-host-limit-corpus-')));
  const text = shellFunction();
  shellValues = CASES.map((value, i) => shellLimit(value, i, text));
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('declaredHostLimit agrees with plot-host.sh budget_reading bitbucket', () => {
  it('exercises a declared limit and the default, so this is not vacuous', () => {
    expect(shellValues).toContain('10000');
    expect(shellValues).toContain('2000');
  });

  it('answers what the shell answers on every recorded value', () => {
    const found: Disagreement[] = [];
    CASES.forEach((value, i) => compareField(found, JSON.stringify(value), 'limit', String(declaredHostLimit(value)), shellValues[i] ?? ''));
    expect(found.map(report)).toEqual([]);
  });
});
