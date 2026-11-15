import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GENERATION_MS, rotationDue } from '../src/rules/budget-rotation.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * Does `rotationDue` answer what `plot-budget.sh`'s `budget_rotation_due`
 * answers?
 *
 * The in-process GitHub client rotates `budget.tsv` before it appends, and the
 * shell appenders keep their own copy of the rule. Each case writes one ledger
 * into its own `PLOT_BUDGET_HOME`, asks the shell with a fixed clock, and asks
 * the rule with the ledger's first line and the same clock.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const BUDGET = join(ROOT, 'skills/plot/scripts/plot-budget.sh');
const report = describingAs({ left: 'rule', right: 'shell' });

/** One ledger and one clock value. `ledger: null` writes no file. */
interface Case {
  readonly name: string;
  readonly ledger: string | null;
  readonly now: number;
}

const AT = 1_788_000_000_000;
const entry = (at: number | string, account = 'someone'): string =>
  `b1\tgithub\t${account}\tgraphql\t${at}\t1\t5000\t4999\t1788003600000\tactual`;
const ledgerOf = (lines: number, firstAt: number | string): string =>
  [entry(firstAt), ...Array.from({ length: lines - 1 }, (_, i) => entry(AT + i + 1))].join('\n') + '\n';

const AGES = [0, 1, 3_600_000, GENERATION_MS - 1, GENERATION_MS, GENERATION_MS + 1, 7 * GENERATION_MS];
const SIZES = [1, 2, 500];

const CASES: readonly Case[] = [
  ...SIZES.flatMap((size) => AGES.map((age) => ({ name: `size=${size} age=${age}`, ledger: ledgerOf(size, AT), now: AT + age }))),
  { name: 'no file', ledger: null, now: AT + 7 * GENERATION_MS },
  { name: 'empty file', ledger: '', now: AT + 7 * GENERATION_MS },
  { name: 'blank first line', ledger: `\n${entry(AT)}\n`, now: AT + 7 * GENERATION_MS },
  { name: 'non-numeric timestamp', ledger: `${entry('12x')}\n`, now: AT + 7 * GENERATION_MS },
  { name: 'short first line', ledger: 'b1\tgithub\tsomeone\n', now: AT + 7 * GENERATION_MS },
  { name: 'unknown format marker', ledger: `b9\tgithub\tsomeone\tgraphql\t${AT}\t1\n`, now: AT + GENERATION_MS },
  { name: 'clock behind the first line', ledger: ledgerOf(2, AT), now: AT - 1 },
];

let sandbox = '';

/** The shell's answer for one case: exit 0 of `budget_rotation_due` is due. */
const shellVerdict = (one: Case, index: number): boolean => {
  const home = mkdtempSync(join(sandbox, `case-${index}-`));
  if (one.ledger !== null) writeFileSync(join(home, 'budget.tsv'), one.ledger);
  const run = spawnSync('bash', ['-c', '. "$1"; budget_rotation_due "$2"', 'corpus', BUDGET, String(one.now)], {
    encoding: 'utf8',
    env: { ...process.env, PLOT_BUDGET_HOME: home },
    timeout: 20_000,
  });
  if (run.error) throw new Error(`plot-budget.sh did not finish: ${run.error.message}`);
  if (run.status !== 0 && run.status !== 1) throw new Error(`budget_rotation_due exited ${run.status}: ${run.stderr}`);
  return run.status === 0;
};

/** The rule's answer for one case. */
const ruleVerdict = (one: Case): boolean => {
  if (one.ledger === null || one.ledger === '') return rotationDue(null, one.now);
  return rotationDue(one.ledger.split('\n')[0] ?? null, one.now);
};

let verdicts: { one: Case; shell: boolean }[] = [];

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-budget-rotation-corpus-'));
  verdicts = CASES.map((one, i) => ({ one, shell: shellVerdict(one, i) }));
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('rotationDue agrees with plot-budget.sh budget_rotation_due', () => {
  it('exercises both answers, so this is not vacuous', () => {
    expect(new Set(verdicts.map((v) => v.shell))).toEqual(new Set([true, false]));
  });

  it('answers what the shell answers, on every recorded ledger size, age and clock value', () => {
    const found: Disagreement[] = [];
    for (const { one, shell } of verdicts) compareField(found, one.name, 'due', ruleVerdict(one), shell);
    expect(found.map(report)).toEqual([]);
  });
});
