import { describe, expect, it } from 'vitest';

import { buildFixture } from '@plot-pm/domain/adapters/build/build-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { WorkflowShaRun } from '@plot-pm/domain/entities/build';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import { defaultBranchRed } from '@plot-pm/domain/rules/default-branch';

import {
  REASK_MS,
  refreshDefaultBranch,
  type DefaultBranchWorld,
} from '../../src/shared/default-branch-refresh.js';

const WAIT = 3_600_000;
const T0 = Date.parse('2026-10-10T10:00:00.000Z');

const run = (workflow: string, conclusion: string | null, status = 'completed'): WorkflowShaRun =>
  ({ sha: 'x', status, conclusion, url: `https://ci/${workflow}`, workflow }) as WorkflowShaRun;

interface Rig {
  world: DefaultBranchWorld;
  stored: () => DefaultBranchReading | null;
  calls: () => number;
  slots: () => number;
  tip: (sha: string | null) => void;
  runs: (sha: string, runs: WorkflowShaRun[]) => void;
  clock: (ms: number) => void;
  fail: (on: boolean) => void;
}

const rig = (initial: DefaultBranchReading | null = null, checks: readonly string[] = []): Rig => {
  let file = initial;
  let now = T0;
  let tipSha: string | null = 'a1';
  let calls = 0;
  let slots = 0;
  let broken = false;
  const byRun: Record<string, WorkflowShaRun[]> = {};
  const store: DefaultBranchStore = {
    read: async () => ({ ok: true, value: file }),
    write: async (reading) => {
      file = reading;
      return { ok: true, value: undefined };
    },
  };
  const world: DefaultBranchWorld = {
    branch: async () => 'main',
    refs: {
      remoteSha: async () =>
        refsFixture({ remoteTips: tipSha === null ? {} : { main: tipSha } }).remoteSha('main'),
    },
    build: {
      runsForSha: (branch, sha) =>
        buildFixture({
          workflowRuns: { [branch]: byRun },
          onRunsForSha: () => {
            calls += 1;
          },
          fails: broken,
        }).runsForSha(branch, sha),
    },
    store,
    slot: async (call) => {
      slots += 1;
      return call();
    },
    now: () => now,
    checksWaitMs: WAIT,
    checks,
  };
  return {
    world,
    stored: () => file,
    calls: () => calls,
    slots: () => slots,
    tip: (sha) => {
      tipSha = sha;
    },
    runs: (sha, list) => {
      byRun[sha] = list;
    },
    clock: (ms) => {
      now = T0 + ms;
    },
    fail: (on) => {
      broken = on;
    },
  };
};

describe('refreshDefaultBranch', () => {
  it('reads a first-run head and settles green', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(r.stored()).toMatchObject({ headSha: 'a1', head: 'green', settled: { sha: 'a1', state: 'green' } });
  });

  it('reads green when only a workflow outside Default branch checks failed', async () => {
    const r = rig(null, ['CI']);
    r.runs('a1', [run('CI', 'success'), run('Release', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()).toMatchObject({ head: 'green', settled: { sha: 'a1', state: 'green' }, failingRuns: [] });
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(false);
  });

  it('reads red and names only the declared workflow that failed', async () => {
    const r = rig(null, ['CI']);
    r.runs('a1', [run('CI', 'failure'), run('Release', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()).toMatchObject({ head: 'red', settled: { sha: 'a1', state: 'red' } });
    expect(r.stored()?.failingRuns).toEqual([{ workflow: 'CI', conclusion: 'failure', url: 'https://ci/CI' }]);
  });

  it('folds every workflow where Default branch checks is absent', async () => {
    const r = rig();
    r.runs('a1', [run('CI', 'success'), run('Release', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.failingRuns.map((failing) => failing.workflow)).toEqual(['Release']);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
  });

  it('makes zero runs-for-sha calls for a settled, unchanged SHA', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    r.clock(10 * REASK_MS);
    expect(await refreshDefaultBranch(r.world)).toBe('skipped');
    expect(r.calls()).toBe(1);
  });

  it('asks a pending head no sooner than five minutes', async () => {
    const r = rig();
    r.runs('a1', [run('ci', null, 'in_progress')]);
    await refreshDefaultBranch(r.world);
    r.clock(REASK_MS - 1);
    expect(await refreshDefaultBranch(r.world)).toBe('skipped');
    expect(r.calls()).toBe(1);
    r.clock(REASK_MS);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(r.calls()).toBe(2);
  });

  it('asks a head past Checks wait at most once per Checks wait', async () => {
    const r = rig();
    r.runs('a1', [run('ci', null, 'queued')]);
    await refreshDefaultBranch(r.world);
    // Inside Checks wait: one ask per REASK_MS, 12 asks in the first hour.
    for (let t = REASK_MS; t < WAIT; t += REASK_MS) {
      r.clock(t);
      await refreshDefaultBranch(r.world);
    }
    expect(r.calls()).toBe(WAIT / REASK_MS);
    const lastAsk = WAIT - REASK_MS;
    // Past Checks wait: refreshing every minute for three hours asks once per Checks wait.
    for (let t = WAIT; t <= 4 * WAIT; t += 60_000) {
      r.clock(t);
      await refreshDefaultBranch(r.world);
    }
    expect(r.calls()).toBe(WAIT / REASK_MS + 3);
    expect(r.stored()?.askedAt).toBe(new Date(T0 + lastAsk + 3 * WAIT).toISOString());
  });

  it('asks a red head again after Checks wait and lifts the hold when a re-run goes green', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
    r.clock(WAIT + REASK_MS);
    r.runs('a1', [run('ci', 'success')]);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(r.stored()?.settled).toEqual({ sha: 'a1', state: 'green' });
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(false);
  });

  it('lifts a settled red after a restart past Checks wait once the pending head went green', async () => {
    const since = new Date(T0).toISOString();
    const r = rig({
      v: DEFAULT_BRANCH_VERSION,
      branch: 'main',
      headSha: 'b2',
      head: 'pending',
      settled: { sha: 'a1', state: 'red' },
      failingRuns: [],
      headSince: since,
      askedAt: since,
      at: since,
    });
    r.tip('b2');
    r.runs('b2', [run('ci', 'success')]);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
    r.clock(2 * WAIT);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(r.calls()).toBe(1);
    expect(r.stored()?.settled).toEqual({ sha: 'b2', state: 'green' });
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(false);
  });

  it('measures Checks wait from when the SHA first appeared, not from the last ask', async () => {
    const r = rig();
    r.runs('a1', [run('ci', null, 'queued')]);
    await refreshDefaultBranch(r.world);
    r.clock(WAIT - REASK_MS);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.headSince).toBe(new Date(T0).toISOString());
    r.clock(WAIT);
    expect(await refreshDefaultBranch(r.world)).toBe('skipped');
  });

  it('re-asks a red head until Checks wait, since a re-run can turn it green', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    r.runs('a1', [run('ci', 'success')]);
    r.clock(REASK_MS);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 'a1', state: 'green' });
    expect(r.stored()?.failingRuns).toEqual([]);
  });

  it('keeps the settled red while a newer HEAD is pending', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    r.tip('b2');
    r.runs('b2', [run('ci', null, 'in_progress')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()).toMatchObject({
      headSha: 'b2',
      head: 'pending',
      settled: { sha: 'a1', state: 'red' },
    });
    expect(r.stored()?.failingRuns).toHaveLength(1);
    // Folding the same pending head twice does not overwrite the settled part.
    r.clock(REASK_MS);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 'a1', state: 'red' });
  });

  it('releases when a newer SHA settles green', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    r.tip('b2');
    r.runs('b2', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 'b2', state: 'green' });
    expect(r.stored()?.failingRuns).toEqual([]);
  });

  it('resets headSince when the SHA moves and asks at once', async () => {
    const r = rig();
    r.runs('a1', [run('ci', null, 'queued')]);
    await refreshDefaultBranch(r.world);
    r.clock(60_000);
    r.tip('b2');
    r.runs('b2', [run('ci', null, 'queued')]);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(r.stored()?.headSince).toBe(new Date(T0 + 60_000).toISOString());
  });

  it('reads a host failure as unknown and keeps the settled part', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    r.tip('b2');
    r.fail(true);
    await refreshDefaultBranch(r.world);
    expect(r.stored()).toMatchObject({ head: 'unknown', settled: { sha: 'a1', state: 'red' } });
  });

  it('reads an unaskable CI as unreadable and writes nothing', async () => {
    const r = rig();
    r.world.build = { runsForSha: async () => ({ ok: false, why: 'unaskable' }) };
    expect(await refreshDefaultBranch(r.world)).toBe('unreadable');
    expect(r.stored()).toBeNull();
  });

  it('keeps a settled red reading when the CI becomes unaskable', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    const before = r.stored();
    r.clock(REASK_MS + 1);
    r.world.build = { runsForSha: async () => ({ ok: false, why: 'unaskable' }) };
    expect(await refreshDefaultBranch(r.world)).toBe('unreadable');
    expect(r.stored()).toEqual(before);
  });

  it('reads no runs as unknown without settling', async () => {
    const r = rig();
    await refreshDefaultBranch(r.world);
    expect(r.stored()).toMatchObject({ head: 'unknown' });
    expect(r.stored()?.settled).toBeUndefined();
  });

  it('writes nothing when the tip cannot be read', async () => {
    const r = rig();
    r.tip(null);
    expect(await refreshDefaultBranch(r.world)).toBe('unreadable');
    expect(r.stored()).toBeNull();
    expect(r.calls()).toBe(0);
  });

  it('takes a host slot for each runs read', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.slots()).toBe(1);
  });
});
