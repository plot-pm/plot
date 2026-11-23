import { describe, expect, it } from 'vitest';

import { buildFixture } from '@plot-pm/domain/adapters/build/build-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import type { WorkflowShaRun } from '@plot-pm/domain/entities/build';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import { declaredRuns, foldRuns } from '@plot-pm/domain/rules/default-branch';
import { rerunSettledOf } from '@plot-pm/domain/rules/repair-start';

import {
  EXPECTED_END_GRACE_MS,
  REASK_MS,
  reaskDue,
  reaskIntervalMs,
  refreshDefaultBranch,
  refreshOnChange,
  runTiming,
  type DefaultBranchWorld,
} from '../../src/shared/default-branch-refresh.js';

const WAIT = 3_600_000;
const T0 = Date.parse('2026-10-10T10:00:00.000Z');
const MIN = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const job = (state: 'pending' | 'green' | 'red', startMs: number, tookMs?: number): WorkflowShaRun =>
  ({
    sha: 'x',
    workflow: 'CI/validate',
    url: 'u',
    startedAt: iso(startMs),
    status: state === 'pending' ? 'in_progress' : 'completed',
    conclusion: state === 'pending' ? null : state === 'green' ? 'success' : 'failure',
    ...(tookMs === undefined ? {} : { completedAt: iso(startMs + tookMs) }),
  }) as WorkflowShaRun;

interface Rig {
  world: DefaultBranchWorld;
  stored: () => DefaultBranchReading | null;
  clock: (ms: number) => void;
  asks: () => number;
  /** What the connector was handed as `declared` on its last ask. */
  declared: () => readonly string[] | undefined;
}

/** A head `a1` whose declared job is pending since `T0`, with `earlierTookMs` learned from a green commit before it. */
const rig = (earlierTookMs: number | undefined, checks: readonly string[] = ['CI/validate'], runs?: WorkflowShaRun[]): Rig => {
  let file: DefaultBranchReading | null = null;
  let now = T0;
  let asks = 0;
  let lastDeclared: readonly string[] | undefined;
  const timing = runTiming();
  if (earlierTookMs !== undefined) timing.observe('g0', [job('green', T0 - 60 * MIN, earlierTookMs)]);
  const world: DefaultBranchWorld = {
    branch: async () => 'main',
    refs: {
      remoteSha: async () => refsFixture({ remoteTips: { main: 'a1' } }).remoteSha('main'),
      firstParentLine: async () => ({ ok: true, value: [] }),
      firstParentCommits: async () => ({ ok: true, value: [] }),
    },
    build: {
      system: () => 'github-actions',
      runsForSha: (branch, sha, declared) => {
        lastDeclared = declared;
        return buildFixture({
          workflowRuns: { [branch]: { a1: runs ?? [job('pending', T0)] } },
          onRunsForSha: () => {
            asks += 1;
          },
        }).runsForSha(branch, sha);
      },
    },
    store: {
      read: async () => ({ ok: true, value: file }),
      write: async (reading) => {
        file = reading;
        return { ok: true, value: undefined };
      },
    },
    slot: (call) => call(),
    now: () => now,
    checksWaitMs: WAIT,
    checks,
    timing,
  };
  return { world, stored: () => file, clock: (ms) => (now = T0 + ms), asks: () => asks, declared: () => lastDeclared };
};

describe('the expected-end re-ask', () => {
  it('asks a pending head at the run\'s expected end, sooner than REASK_MS', async () => {
    const r = rig(3 * MIN);
    await refreshDefaultBranch(r.world);
    r.clock(3 * MIN + EXPECTED_END_GRACE_MS - 1);
    expect(await refreshDefaultBranch(r.world)).toBe('skipped');
    r.clock(3 * MIN + EXPECTED_END_GRACE_MS);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(r.asks()).toBe(2);
  });

  it('asks a pending head whose expected end lies beyond REASK_MS at REASK_MS, not later', async () => {
    const r = rig(20 * MIN);
    await refreshDefaultBranch(r.world);
    r.clock(REASK_MS - 1);
    expect(await refreshDefaultBranch(r.world)).toBe('skipped');
    r.clock(REASK_MS);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
  });

  it('asks at REASK_MS where no duration is known', async () => {
    const r = rig(undefined);
    await refreshDefaultBranch(r.world);
    r.clock(REASK_MS - 1);
    expect(await refreshDefaultBranch(r.world)).toBe('skipped');
    r.clock(REASK_MS);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
  });

  it('does not ask on every tick once the expected end has passed', async () => {
    const r = rig(1 * MIN);
    await refreshDefaultBranch(r.world);
    r.clock(MIN + EXPECTED_END_GRACE_MS);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    const secondAskAt = MIN + EXPECTED_END_GRACE_MS;
    for (let t = secondAskAt + 10_000; t < secondAskAt + REASK_MS; t += 10_000) {
      r.clock(t);
      expect(await refreshDefaultBranch(r.world)).toBe('skipped');
    }
    r.clock(secondAskAt + REASK_MS);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(r.asks()).toBe(3);
  });

  it('uses the same interval on the refreshOnChange path', async () => {
    const r = rig(3 * MIN);
    const refresh = refreshOnChange(r.world, async () => 'tip-1');
    expect(await refresh()).toBe('asked');
    r.clock(3 * MIN + EXPECTED_END_GRACE_MS - 1);
    expect(await refresh()).toBe('skipped');
    r.clock(3 * MIN + EXPECTED_END_GRACE_MS);
    expect(await refresh()).toBe('asked');
  });

  it('keeps the cadence of a green and a red head: the expected end reaches only a pending one', () => {
    const base = { v: 1, branch: 'main', headSha: 'a1', failingRuns: [], headSince: iso(T0), askedAt: iso(T0), at: iso(T0) } as const;
    const end = T0 + MIN;
    const green = { ...base, head: 'green' } as DefaultBranchReading;
    const red = { ...base, head: 'red' } as DefaultBranchReading;
    expect(reaskDue(green, T0 + 2 * MIN, WAIT, end)).toBe(false);
    expect(reaskDue(green, T0 + WAIT / 2, WAIT, end)).toBe(true);
    expect(reaskDue(red, T0 + REASK_MS - 1, WAIT, end)).toBe(false);
    expect(reaskDue(red, T0 + REASK_MS, WAIT, end)).toBe(true);
    expect(reaskIntervalMs(WAIT, true, MIN)).toBe(WAIT / 2);
    expect(reaskIntervalMs(WAIT, false)).toBe(REASK_MS);
  });

  it('keeps a pending head past Checks wait at half Checks wait whatever its expected end', () => {
    const pending = { v: 1, branch: 'main', headSha: 'a1', head: 'pending', failingRuns: [], headSince: iso(T0 - WAIT), askedAt: iso(T0), at: iso(T0) } as DefaultBranchReading;
    expect(reaskDue(pending, T0 + REASK_MS, WAIT, T0 + MIN)).toBe(false);
    expect(reaskDue(pending, T0 + WAIT / 2, WAIT, T0 + MIN)).toBe(true);
  });
});

describe('unread inputs never read as green or as ending now', () => {
  it('reads a declared job no run carries as unknown', async () => {
    const r = rig(3 * MIN, ['CI/validate'], [{ ...job('green', T0, MIN), workflow: 'CI' } as WorkflowShaRun]);
    const warnings: string[] = [];
    await refreshDefaultBranch(r.world, (line) => warnings.push(line));
    expect(r.stored()?.head).toBe('unknown');
    expect(warnings.some((line) => line.includes("'CI/validate' matched no run"))).toBe(true);
  });

  it('reads an empty run list as unknown and asks at REASK_MS', async () => {
    const r = rig(3 * MIN, ['CI/validate'], []);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.head).toBe('unknown');
    r.clock(REASK_MS - 1);
    expect(await refreshDefaultBranch(r.world)).toBe('skipped');
  });

  it('learns no duration from a run that reports no end', () => {
    const timing = runTiming();
    timing.observe('g', [job('green', T0 - 30 * MIN)]);
    timing.observe('a1', [job('pending', T0)]);
    expect(timing.expectedEndMs('a1')).toBeUndefined();
  });

  it('learns no duration from a failed run', () => {
    const timing = runTiming();
    timing.observe('g', [job('red', T0 - 30 * MIN, 5 * MIN)]);
    timing.observe('a1', [job('pending', T0)]);
    expect(timing.expectedEndMs('a1')).toBeUndefined();
  });
});

describe('one fold for every caller of declaredRuns', () => {
  it('hands the connector the declared names and folds the same runs to the same state as a second caller', async () => {
    const runs = [{ ...job('red', T0, MIN), workflow: 'CI' } as WorkflowShaRun, job('green', T0, MIN)];
    const r = rig(undefined, ['CI/validate'], runs);
    await refreshDefaultBranch(r.world);
    expect(r.declared()).toEqual(['CI/validate']);
    const refreshState = r.stored()?.head;
    const record = { rerun: 'asked', at: iso(T0 - 10 * MIN) } as Parameters<typeof rerunSettledOf>[0];
    expect(refreshState).toBe('green');
    expect(foldRuns(declaredRuns(runs, ['CI/validate']))).toBe(refreshState);
    expect(rerunSettledOf(record, runs, ['CI/validate'], T0, 60 * MIN)).toEqual({ settled: refreshState });
    expect(rerunSettledOf(record, runs, ['CI'], T0, 60 * MIN)).toEqual({ settled: 'red' });
  });
});
