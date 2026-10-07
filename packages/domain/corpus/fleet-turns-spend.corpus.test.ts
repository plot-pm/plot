import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { readSpend } from '../src/rules/slice-spend-record.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE RULE-VERSUS-SCRIPT COMPARISON FOR `count-fleet-turns.mjs`: does its
 * duplicated `sealedSlices`/`sessionIncrease` answer what `readSpend` answers,
 * over every branch in a slice-spend record built to cover the cases
 * `readSpend`'s own suite covers — a seal-only branch, a run-only branch, a
 * multi-session branch, a resumed session (cumulative lines), a counter
 * reset, a zeroed run, and a branch carrying BOTH a seal and run lines (the
 * straddling case the script names rather than silently splitting).
 *
 * `docs/shell-and-domain.md`'s cost rule: `count-fleet-turns.mjs` runs once
 * per OPERATOR COMMAND (a measurement script invoked by hand or by a plan
 * step), which the rule would let call through a bundle — but the domain
 * package has no built dist a plain `.mjs` at the repo root can import
 * (`package.json`'s `"main": "./src/index.ts"`, no `tsx`/`ts-node` at the
 * root), so the script duplicates the reducer instead, exactly as
 * `count-master-diagnosis.mjs` duplicates `transcriptDirFor`. The brief for
 * `the-sdk-is-the-default-runner` asks that a duplicate judgement be declared
 * with a comparison test rather than left to drift — this is that test.
 *
 * NEITHER SIDE IS AUTHORITATIVE. The test says they agree. On a disagreement
 * the branch stops; adjusting either side to make the comparison pass is the
 * one move forbidden.
 *
 * ONE DIVERGENCE IS DECLARED RATHER THAN HIDDEN: `readSpend` sums a seal line
 * and run lines TOGETHER when a branch carries both — correct for a reader
 * who wants the branch's whole cost regardless of which runner produced it.
 * The script's `sealedSlices` instead attributes a straddling branch to ONE
 * runner (the newest contribution) and counts it once there, because the
 * bar this script serves asks "which runner produced this slice's cost,"
 * never "what did this branch cost in total." `STRADDLING_SUBJECTS` below
 * names the one fixture case this divergence applies to; a NEW disagreement
 * outside that set still fails.
 */

const SCRIPT = new URL('../../../scripts/count-fleet-turns.mjs', import.meta.url).pathname;

const SIDES: Sides = { left: 'script', right: 'rule' };
const report = describingAs(SIDES);

/** The subjects where `sealedSlices` deliberately diverges from `readSpend` — see the module header. */
const STRADDLING_SUBJECTS = new Set(['infra/straddling']);

/** One slice-spend run line, matching `SliceSpendRunSchema`. */
const run = (over: Record<string, unknown> = {}) => ({
  kind: 'run',
  branch: 'infra/sample',
  at: '2026-10-01T10:00:00.000Z',
  sessionId: 'session-1',
  role: 'worker',
  models: {
    'claude-sonnet-5': { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40, costUsd: 1 },
  },
  costUsd: 1,
  turns: 3,
  ...over,
});

/** One slice-spend seal line, matching `SliceSpendSealSchema`. */
const seal = (over: Record<string, unknown> = {}) => ({
  branch: 'infra/sample',
  at: '2026-09-15T10:00:00.000Z',
  tokens: { inputTokens: 2, outputTokens: 169, cacheCreationTokens: 80_247, cacheReadTokens: 13_236 },
  turns: 1,
  models: ['claude-opus-5'],
  ...over,
});

/** The zeroed-run shape `isZeroedRun` skips entirely — a run that did not start. */
const zeroedRun = (over: Record<string, unknown> = {}) =>
  run({
    models: { 'claude-sonnet-5': { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0 } },
    costUsd: 0,
    ...over,
  });

interface Case {
  name: string;
  branch: string;
  lines: ReadonlyArray<Record<string, unknown>>;
}

const cases: Case[] = [
  { name: 'seal-only', branch: 'command/seal-only', lines: [seal({ branch: 'command/seal-only' })] },
  { name: 'run-only-single-session', branch: 'sdk/run-only', lines: [run({ branch: 'sdk/run-only' })] },
  {
    name: 'run-only-resumed-session-cumulative',
    branch: 'sdk/resumed',
    lines: [
      run({
        branch: 'sdk/resumed',
        sessionId: 'session-r',
        models: { 'claude-sonnet-5': { inputTokens: 10, outputTokens: 10, cacheCreationTokens: 10, cacheReadTokens: 10, costUsd: 1 } },
        costUsd: 1,
      }),
      run({
        branch: 'sdk/resumed',
        sessionId: 'session-r',
        at: '2026-10-01T11:00:00.000Z',
        models: { 'claude-sonnet-5': { inputTokens: 25, outputTokens: 25, cacheCreationTokens: 25, cacheReadTokens: 25, costUsd: 3 } },
        costUsd: 3,
      }),
    ],
  },
  {
    name: 'run-only-counter-reset',
    branch: 'sdk/reset',
    lines: [
      run({
        branch: 'sdk/reset',
        sessionId: 'session-reset',
        models: { 'claude-sonnet-5': { inputTokens: 50, outputTokens: 50, cacheCreationTokens: 50, cacheReadTokens: 50, costUsd: 5 } },
        costUsd: 5,
      }),
      run({
        branch: 'sdk/reset',
        sessionId: 'session-reset',
        at: '2026-10-01T11:00:00.000Z',
        models: { 'claude-sonnet-5': { inputTokens: 5, outputTokens: 5, cacheCreationTokens: 5, cacheReadTokens: 5, costUsd: 1 } },
        costUsd: 1,
      }),
    ],
  },
  {
    name: 'run-with-zeroed-line-skipped',
    branch: 'sdk/zeroed',
    lines: [
      zeroedRun({ branch: 'sdk/zeroed', sessionId: 'session-z' }),
      run({
        branch: 'sdk/zeroed',
        sessionId: 'session-z',
        at: '2026-10-01T11:00:00.000Z',
        models: { 'claude-sonnet-5': { inputTokens: 15, outputTokens: 15, cacheCreationTokens: 15, cacheReadTokens: 15, costUsd: 2 } },
        costUsd: 2,
      }),
    ],
  },
  {
    name: 'multi-session-sums-each',
    branch: 'sdk/multi',
    lines: [
      run({ branch: 'sdk/multi', sessionId: 'session-a' }),
      run({ branch: 'sdk/multi', sessionId: 'session-b', at: '2026-10-01T12:00:00.000Z' }),
    ],
  },
  {
    name: 'straddling-seal-and-run',
    branch: 'infra/straddling',
    lines: [seal({ branch: 'infra/straddling', at: '2026-09-15T10:00:00.000Z' }), run({ branch: 'infra/straddling', at: '2026-10-01T10:00:00.000Z' })],
  },
];

/** Runs the script's `sealedSlices` over one case's lines via a Node subprocess, importing the same module the CLI uses. */
const scriptSealed = (lines: readonly string[]): { weightedTokens: number } | null => {
  const payload = JSON.stringify(lines);
  const out = execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `
      import { sealedSlices } from '${SCRIPT}';
      const lines = JSON.parse(process.argv[1]);
      const { sealed } = sealedSlices(lines);
      process.stdout.write(JSON.stringify([...sealed.entries()]));
      `,
      payload,
    ],
    { encoding: 'utf8' },
  );
  const entries: Array<[string, { weightedTokens: number }]> = JSON.parse(out);
  const map = new Map(entries);
  return map.size === 0 ? null : (map.values().next().value as { weightedTokens: number });
};

/** Weighted tokens (cache read at 1/10) from a `TokenCountsRecord`. */
const weighted = (t: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }): number =>
  t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens / 10;

describe('count-fleet-turns.mjs sealedSlices vs. readSpend', () => {
  for (const testCase of cases) {
    it(`agrees with readSpend on ${testCase.name}`, () => {
      const lines = testCase.lines.map((l) => JSON.stringify(l));
      const ruleRead = readSpend(lines, testCase.branch);
      const ruleWeighted = ruleRead.tokens === null ? null : weighted(ruleRead.tokens);

      const scriptRead = scriptSealed(lines);
      const scriptWeighted = scriptRead === null ? null : scriptRead.weightedTokens;

      const found: Disagreement[] = [];
      compareField(found, testCase.branch, 'weightedTokens', scriptWeighted, ruleWeighted);

      if (STRADDLING_SUBJECTS.has(testCase.branch)) {
        expect(found.map((d) => d.subject)).toEqual([testCase.branch]);
        return;
      }
      expect(found.map(report)).toEqual([]);
    });
  }

  it('STRADDLING_SUBJECTS names exactly the cases that carry both a seal and a run line', () => {
    const straddlers = cases.filter((c) => c.lines.some((l) => l.kind === 'run') && c.lines.some((l) => l.kind !== 'run'));
    expect(straddlers.map((c) => c.branch).sort()).toEqual([...STRADDLING_SUBJECTS].sort());
  });
});
