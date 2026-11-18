import { describe, expect, it } from 'vitest';

import { buildFixture } from '@plot-pm/domain/adapters/build/build-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { RepairRecord } from '@plot-pm/domain/entities/repair-record';
import type { WorkflowShaRun } from '@plot-pm/domain/entities/build';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import type { RepairRecordStore } from '@plot-pm/domain/ports/repair-record';
import { ANCESTOR_ASKS_MAX, defaultBranchAgeMs, defaultBranchRed } from '@plot-pm/domain/rules/default-branch';

import {
  REASK_MS,
  refreshBases,
  refreshDefaultBranch,
  refreshOnChange,
  refreshWithBases,
  type BaseRefreshWorld,
  type DefaultBranchWorld,
} from '../../src/shared/default-branch-refresh.js';

const WAIT = 3_600_000;
const T0 = Date.parse('2026-10-10T10:00:00.000Z');

const run = (workflow: string, conclusion: string | null, status = 'completed'): WorkflowShaRun =>
  ({ sha: 'x', status, conclusion, url: `https://ci/${workflow}`, workflow }) as WorkflowShaRun;

interface Rig {
  world: DefaultBranchWorld;
  stored: () => DefaultBranchReading | null;
  repair: () => RepairRecord | null;
  calls: () => number;
  slots: () => number;
  tip: (sha: string | null) => void;
  runs: (sha: string, runs: WorkflowShaRun[]) => void;
  clock: (ms: number) => void;
  fail: (on: boolean) => void;
  line: (shas: readonly string[]) => void;
  failOn: (sha: string) => void;
  asked: () => readonly string[];
}

const rig = (
  initial: DefaultBranchReading | null = null,
  checks: readonly string[] = [],
  initialRepair: RepairRecord | null = null,
): Rig => {
  let file = initial;
  let repairRecord = initialRepair;
  let now = T0;
  let tipSha: string | null = 'a1';
  let calls = 0;
  let slots = 0;
  let broken = false;
  let firstParents: readonly string[] = [];
  let rangeCommits: Record<string, readonly { sha: string; tree: string; subject: string; forward: boolean }[]> = {};
  let rangeFails = false;
  const failing = new Set<string>();
  const askedShas: string[] = [];
  const byRun: Record<string, WorkflowShaRun[]> = {};
  const store: DefaultBranchStore = {
    read: async () => ({ ok: true, value: file }),
    write: async (reading) => {
      file = reading;
      return { ok: true, value: undefined };
    },
  };
  const repair: RepairRecordStore = {
    read: async () => ({ ok: true, value: repairRecord }),
    write: async (record) => {
      repairRecord = record;
      return { ok: true, value: undefined };
    },
  };
  const world: DefaultBranchWorld = {
    branch: async () => 'main',
    refs: {
      remoteSha: async () =>
        refsFixture({ remoteTips: tipSha === null ? {} : { main: tipSha } }).remoteSha('main'),
      firstParentLine: (sha, max) => refsFixture({ firstParentLine: firstParents }).firstParentLine(sha, max),
      firstParentCommits: (range) =>
        refsFixture({ firstParentCommitLists: rangeCommits, failing: rangeFails ? ['firstParentCommits'] : [] }).firstParentCommits(range),
    },
    build: {
      system: () => 'github-actions',
      runsForSha: (branch, sha) =>
        buildFixture({
          workflowRuns: { [branch]: byRun },
          onRunsForSha: () => {
            calls += 1;
            askedShas.push(sha);
          },
          fails: broken || failing.has(sha),
        }).runsForSha(branch, sha),
    },
    store,
    repair,
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
    repair: () => repairRecord,
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
    line: (shas) => {
      firstParents = shas;
    },
    range: (range, commits) => {
      rangeCommits = { ...rangeCommits, [range]: commits };
    },
    failRange: (on) => {
      rangeFails = on;
    },
    failOn: (sha) => {
      failing.add(sha);
    },
    asked: () => askedShas,
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

  it('warns when a declared check matches no run, apart from a quiet repository', async () => {
    const mismatched = rig(null, ['Lint']);
    mismatched.runs('a1', [run('CI', 'success')]);
    const warnMismatch: string[] = [];
    await refreshDefaultBranch(mismatched.world, (line) => warnMismatch.push(line));
    expect(mismatched.stored()).toMatchObject({ head: 'unknown' });
    expect(warnMismatch).toEqual(["plot-fleetd: default-branch check 'Lint' matched no run for a1"]);

    const quiet = rig(null, ['Lint']);
    quiet.runs('a1', []);
    const warnQuiet: string[] = [];
    await refreshDefaultBranch(quiet.world, (line) => warnQuiet.push(line));
    expect(quiet.stored()).toMatchObject({ head: 'unknown' });
    expect(warnQuiet).toEqual(["plot-fleetd: default-branch check 'Lint' matched no run for a1"],
      'a repository with no runs at all still names the configured check it could not match');
  });

  it('warns about nothing when Default branch checks is absent or every name matches', async () => {
    const noChecks = rig();
    noChecks.runs('a1', [run('CI', 'success')]);
    const warnNoChecks: string[] = [];
    await refreshDefaultBranch(noChecks.world, (line) => warnNoChecks.push(line));
    expect(warnNoChecks).toEqual([]);

    const matched = rig(null, ['CI']);
    matched.runs('a1', [run('CI', 'success')]);
    const warnMatched: string[] = [];
    await refreshDefaultBranch(matched.world, (line) => warnMatched.push(line));
    expect(warnMatched).toEqual([]);
  });

  it('folds every workflow where Default branch checks is absent', async () => {
    const r = rig();
    r.runs('a1', [run('CI', 'success'), run('Release', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.failingRuns.map((failing) => failing.workflow)).toEqual(['Release']);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
  });

  it('makes zero runs-for-sha calls for a green, unchanged SHA inside half Checks wait', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    r.clock(WAIT / 2 - 1);
    expect(await refreshDefaultBranch(r.world)).toBe('skipped');
    expect(r.calls()).toBe(1);
  });

  it('asks a green, unchanged SHA once per half Checks wait, so askedAt never ages past it', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    for (let t = 60_000; t <= 4 * WAIT; t += 60_000) {
      r.clock(t);
      await refreshDefaultBranch(r.world);
      expect(defaultBranchAgeMs(r.stored()!, r.world.now())).toBeLessThan(WAIT / 2);
    }
    expect(r.calls()).toBe(1 + 8);
    expect(r.stored()).toMatchObject({ head: 'green', headSince: new Date(T0).toISOString() });
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

  it('asks a head past Checks wait once per half Checks wait', async () => {
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
    // Past Checks wait: refreshing every minute for three hours asks once per half Checks wait.
    for (let t = WAIT; t <= 4 * WAIT; t += 60_000) {
      r.clock(t);
      await refreshDefaultBranch(r.world);
    }
    expect(r.calls()).toBe(WAIT / REASK_MS + 6);
    expect(r.stored()?.askedAt).toBe(new Date(T0 + lastAsk + 6 * (WAIT / 2)).toISOString());
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

  it.each([
    ['one hour', WAIT],
    ['REASK_MS', REASK_MS],
  ])('keeps a red head held at every 5 s point across 3 x Checks wait of %s, with off-beat refreshes', async (_name, wait) => {
    const r = rig();
    r.world.checksWaitMs = wait;
    r.runs('a1', [run('ci', 'failure')]);
    const missing: number[] = [];
    // The refresh runs after readPrs() on the 60 s beat: 65 s apart, starting 35 s after
    // the first ask, so it drifts against both the minute and the 5 s supervision tick.
    for (let t = 0; t <= 3 * wait; t += 5_000) {
      r.clock(t);
      if (t === 0 || (t - 35_000) % 65_000 === 0) await refreshDefaultBranch(r.world);
      if (!defaultBranchRed(r.stored(), r.world.now(), wait)) missing.push(t);
    }
    expect(missing).toEqual([]);
  });

  it('ages a red reading from the last answer while the host keeps failing', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    const answered = r.stored()?.askedAt;
    r.fail(true);
    const asksBefore = r.calls();
    for (let t = 60_000; t <= WAIT + 60_000; t += 60_000) {
      r.clock(t);
      await refreshDefaultBranch(r.world);
    }
    // Failed asks keep the answer's askedAt, record themselves in `at`, and keep the interval.
    expect(r.stored()).toMatchObject({ head: 'unknown', settled: { sha: 'a1', state: 'red' }, askedAt: answered });
    // Asked every REASK_MS until Checks wait; past it, the 55 min ask waits half a Checks wait.
    expect(r.stored()?.at).toBe(new Date(T0 + WAIT - REASK_MS).toISOString());
    expect(r.calls() - asksBefore).toBe(WAIT / REASK_MS - 1);
    r.clock(WAIT);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
    r.clock(WAIT + 1);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(false);
    // The next answer renews the hold.
    r.fail(false);
    r.clock(WAIT - REASK_MS + WAIT / 2);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
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

  it('reads an unaskable CI as unreadable, writes nothing, and names the reason', async () => {
    const r = rig();
    r.world.build = { system: () => 'github-actions', runsForSha: async () => ({ ok: false, why: 'unaskable' }) };
    const warned: string[] = [];
    expect(await refreshDefaultBranch(r.world, (line) => warned.push(line))).toBe('unreadable');
    expect(r.stored()).toBeNull();
    expect(warned).toEqual(["plot-fleetd: default-branch read skipped — CI did not answer for 'main' at a1"]);
  });

  it('keeps a settled red reading when the CI becomes unaskable', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    const before = r.stored();
    r.clock(REASK_MS + 1);
    r.world.build = { system: () => 'github-actions', runsForSha: async () => ({ ok: false, why: 'unaskable' }) };
    expect(await refreshDefaultBranch(r.world)).toBe('unreadable');
    expect(r.stored()).toEqual(before);
  });

  it('reads no tip and asks no CI where no CI system is declared, and names the reason', async () => {
    const r = rig();
    let tips = 0;
    r.world.refs = {
      ...r.world.refs,
      remoteSha: async () => {
        tips += 1;
        return { ok: true, value: { sha: 'a1' } };
      },
    };
    r.world.build = { ...r.world.build, system: () => '' };
    const warned: string[] = [];
    expect(await refreshDefaultBranch(r.world, (line) => warned.push(line))).toBe('unreadable');
    expect(tips).toBe(0);
    expect(r.calls()).toBe(0);
    expect(r.stored()).toBeNull();
    expect(warned).toEqual(['plot-fleetd: default-branch read skipped — no CI system is declared']);
  });

  it('keeps a held reading where no CI system is declared', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    const before = r.stored();
    r.clock(REASK_MS + 1);
    r.world.build = { ...r.world.build, system: () => '' };
    expect(await refreshDefaultBranch(r.world)).toBe('unreadable');
    expect(r.stored()).toEqual(before);
  });

  it('reads no runs as unknown without settling', async () => {
    const r = rig();
    await refreshDefaultBranch(r.world);
    expect(r.stored()).toMatchObject({ head: 'unknown' });
    expect(r.stored()?.settled).toBeUndefined();
  });

  it('writes nothing when the tip cannot be read, and names the reason', async () => {
    const r = rig();
    r.tip(null);
    const warned: string[] = [];
    expect(await refreshDefaultBranch(r.world, (line) => warned.push(line))).toBe('unreadable');
    expect(r.stored()).toBeNull();
    expect(r.calls()).toBe(0);
    expect(warned).toEqual(["plot-fleetd: default-branch read skipped — the remote tip of 'main' could not be read"]);
  });

  it('names the reason when the default branch itself cannot be read', async () => {
    const r = rig();
    r.world.branch = async () => null;
    const warned: string[] = [];
    expect(await refreshDefaultBranch(r.world, (line) => warned.push(line))).toBe('unreadable');
    expect(r.stored()).toBeNull();
    expect(warned).toEqual(['plot-fleetd: default-branch read skipped — the default branch could not be read']);
  });

  it('takes a host slot for each runs read', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.slots()).toBe(1);
  });
});

describe('refreshDefaultBranch — the repair record', () => {
  const green = (sha: string): DefaultBranchReading => ({
    v: DEFAULT_BRANCH_VERSION,
    branch: 'main',
    headSha: sha,
    head: 'green',
    settled: { sha, state: 'green' },
    failingRuns: [],
    headSince: new Date(T0).toISOString(),
    askedAt: new Date(T0).toISOString(),
    at: new Date(T0).toISOString(),
  });

  it('writes a record at the change from a green settled reading to a red one (advanceSettled arm)', async () => {
    const r = rig(green('g1'));
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 'r1', state: 'red' });
    expect(r.repair()).toMatchObject({ branch: 'main', state: 'idle', lastGreenSha: 'g1', firstRedSha: 'r1' });
  });

  it('writes a record at the change to red found behind a pending head (settleBehindHead arm)', async () => {
    const r = rig(green('g1'));
    r.line(['h', 'r1', 'g1']);
    r.tip('h');
    r.runs('h', [run('ci', null, 'in_progress')]);
    r.runs('r1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 'r1', state: 'red' });
    expect(r.repair()).toMatchObject({ branch: 'main', state: 'idle', lastGreenSha: 'g1', firstRedSha: 'r1' });
  });

  it('writes a record with no lastGreenSha where there was no previous reading, and warns', async () => {
    const r = rig(null);
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    const warnings: string[] = [];
    await refreshDefaultBranch(r.world, (line) => warnings.push(line));
    expect(r.repair()).toMatchObject({ branch: 'main', state: 'idle', firstRedSha: 'r1' });
    expect(r.repair()?.lastGreenSha).toBeUndefined();
    expect(warnings.some((line) => line.includes('no last green SHA'))).toBe(true);
  });

  it('writes the commits of lastGreenSha..firstRedSha as candidates, newest first, without a forward merge', async () => {
    const r = rig(green('g1'));
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    r.range('g1..r1', [
      { sha: 'r1', tree: 't', subject: 'B (#3)', forward: false },
      { sha: 'f1', tree: 't', subject: 'Merge main', forward: true },
      { sha: 'm1', tree: 't', subject: 'A (#1)', forward: false },
    ]);
    await refreshDefaultBranch(r.world);
    expect(r.repair()?.candidates).toEqual([
      { sha: 'r1', subject: 'B (#3)' },
      { sha: 'm1', subject: 'A (#1)' },
    ]);
  });

  it('keeps no candidates, and warns, where the range cannot be read', async () => {
    const r = rig(green('g1'));
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    r.failRange(true);
    const warnings: string[] = [];
    await refreshDefaultBranch(r.world, (line) => warnings.push(line));
    expect(r.repair()?.candidates).toEqual([]);
    expect(warnings.some((line) => line.includes('could not be read'))).toBe(true);
  });

  it('keeps no candidates where there was no previous reading', async () => {
    const r = rig(null);
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    r.range('g1..r1', [{ sha: 'r1', tree: 't', subject: 'B (#3)', forward: false }]);
    await refreshDefaultBranch(r.world);
    expect(r.repair()?.candidates).toEqual([]);
  });

  it('writes no record where the settled part stays red across a refresh', async () => {
    const r = rig(green('g1'));
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    const firstRecord = r.repair();

    r.clock(REASK_MS);
    r.runs('r1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.repair()).toEqual(firstRecord);
  });

  const named = (over: Partial<RepairRecord> = {}): RepairRecord => ({
    v: 1,
    branch: 'main',
    state: 'idle',
    lastGreenSha: 'g1',
    firstRedSha: 'r1',
    redSince: new Date(T0).toISOString(),
    candidates: [],
    rerun: 'none',
    preRevertRerun: 'none',
    repairPr: 2942,
    at: new Date(T0).toISOString(),
    ...over,
  });

  it('keeps a person-recorded repairPr when the same episode turns red again (the race)', async () => {
    // The reading was not written after the first change to red, so fleetd
    // sees green -> red on r1 a second time, after a person recorded #2942.
    const r = rig(green('g1'), [], named());
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.repair()).toEqual(named());
  });

  it('replaces a record of another episode, dropping its repairPr', async () => {
    const r = rig(green('g1'), [], named({ firstRedSha: 'r0' }));
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.repair()).toMatchObject({ firstRedSha: 'r1', state: 'idle' });
    expect(r.repair()?.repairPr).toBeUndefined();
  });

  it('replaces a settled record of the same first red SHA', async () => {
    const r = rig(green('g1'), [], named({ state: 'done' }));
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.repair()).toMatchObject({ firstRedSha: 'r1', state: 'idle' });
    expect(r.repair()?.repairPr).toBeUndefined();
  });

  it('writes no record where the record on disk cannot be read, and warns', async () => {
    const r = rig(green('g1'), [], named());
    const writes: RepairRecord[] = [];
    r.world.repair = {
      read: async () => ({ ok: false, why: 'failed' }) as never,
      write: async (record) => {
        writes.push(record);
        return { ok: true, value: undefined };
      },
    };
    r.tip('r1');
    r.runs('r1', [run('ci', 'failure')]);
    const warnings: string[] = [];
    await refreshDefaultBranch(r.world, (line) => warnings.push(line));
    expect(writes).toEqual([]);
    expect(warnings.some((line) => line.includes('could not be read'))).toBe(true);
    expect(r.stored()?.settled).toEqual({ sha: 'r1', state: 'red' });
  });

  it('writes no record where the head stays green across a refresh', async () => {
    const r = rig(green('g1'));
    r.clock(WAIT / 2);
    r.runs('g1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.repair()).toBeNull();
  });
});

describe('refreshDefaultBranch — the walk past a pending head', () => {
  const settledRed = (headSha = 's'): DefaultBranchReading => {
    const since = new Date(T0).toISOString();
    return {
      v: DEFAULT_BRANCH_VERSION,
      branch: 'main',
      headSha,
      head: 'red',
      settled: { sha: 's', state: 'red' },
      failingRuns: [{ workflow: 'ci', conclusion: 'failure', url: 'https://ci/ci' }],
      headSince: since,
      askedAt: since,
      at: since,
    };
  };

  it('settles green at the newest green commit behind a pending head', async () => {
    const r = rig(settledRed());
    r.line(['h', 'g2', 'g1', 's', 'old']);
    r.tip('h');
    r.runs('h', [run('ci', null, 'in_progress')]);
    r.runs('g2', [run('ci', 'success')]);
    r.runs('g1', [run('ci', 'success')]);
    expect(await refreshDefaultBranch(r.world)).toBe('asked');
    expect(r.stored()).toMatchObject({ headSha: 'h', head: 'pending', settled: { sha: 'g2', state: 'green' }, failingRuns: [] });
    expect(r.asked()).toEqual(['h', 'g2']);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(false);
  });

  it('settles red at a red commit newer than a green one', async () => {
    const r = rig({ ...settledRed(), settled: { sha: 's', state: 'green' }, failingRuns: [] });
    r.line(['h', 'r2', 'g1', 's']);
    r.tip('h');
    r.runs('h', [run('ci', null, 'queued')]);
    r.runs('r2', [run('ci', 'failure')]);
    r.runs('g1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 'r2', state: 'red' });
    expect(r.stored()?.failingRuns).toEqual([{ workflow: 'ci', conclusion: 'failure', url: 'https://ci/ci' }]);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
  });

  it('asks past pending and unknown ancestors to the newest concluded one', async () => {
    const r = rig(settledRed());
    r.line(['h', 'p2', 'u1', 'g0', 's']);
    r.tip('h');
    r.runs('h', [run('ci', null, 'in_progress')]);
    r.runs('p2', [run('ci', null, 'in_progress')]);
    r.runs('g0', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.asked()).toEqual(['h', 'p2', 'u1', 'g0']);
    expect(r.stored()?.settled).toEqual({ sha: 'g0', state: 'green' });
  });

  it('walks past a head whose runs read unknown', async () => {
    const r = rig(settledRed());
    r.line(['h', 'g1', 's']);
    r.tip('h');
    r.runs('g1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()).toMatchObject({ head: 'unknown', settled: { sha: 'g1', state: 'green' } });
  });

  it('falls back to the head-only reading when the settled commit is not on the line', async () => {
    const r = rig(settledRed());
    // A force-push rewrote main: `s` is no longer on the head's first-parent line.
    r.line(['h', 'g2', 'g1', 'x']);
    r.tip('h');
    r.runs('h', [run('ci', null, 'in_progress')]);
    r.runs('g2', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.asked()).toEqual(['h']);
    expect(r.stored()).toMatchObject({ settled: { sha: 's', state: 'red' } });
    expect(r.stored()?.failingRuns).toHaveLength(1);
  });

  it('falls back to the head-only reading when the head is not fetched', async () => {
    const r = rig(settledRed());
    r.line(['g1', 's']);
    r.tip('h');
    r.runs('h', [run('ci', null, 'in_progress')]);
    r.runs('g1', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.asked()).toEqual(['h']);
    expect(r.stored()?.settled).toEqual({ sha: 's', state: 'red' });
  });

  it('keeps the previous settled reading when the host fails partway', async () => {
    const r = rig(settledRed());
    r.line(['h', 'p2', 'f1', 'g0', 's']);
    r.tip('h');
    r.runs('h', [run('ci', null, 'in_progress')]);
    r.runs('p2', [run('ci', null, 'in_progress')]);
    r.failOn('f1');
    r.runs('g0', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.asked()).toEqual(['h', 'p2', 'f1']);
    expect(r.stored()).toMatchObject({ head: 'pending', settled: { sha: 's', state: 'red' } });
    expect(r.stored()?.failingRuns).toHaveLength(1);
  });

  it(`asks at most ${ANCESTOR_ASKS_MAX} ancestors per refresh, each in a host slot`, async () => {
    const r = rig(settledRed());
    const pending = Array.from({ length: 2 * ANCESTOR_ASKS_MAX }, (_, i) => `p${i}`);
    r.line(['h', ...pending, 'g', 's']);
    r.tip('h');
    for (const sha of ['h', ...pending]) r.runs(sha, [run('ci', null, 'in_progress')]);
    r.runs('g', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.calls()).toBe(1 + ANCESTOR_ASKS_MAX);
    expect(r.slots()).toBe(1 + ANCESTOR_ASKS_MAX);
    expect(r.asked()).toEqual(['h', ...pending.slice(0, ANCESTOR_ASKS_MAX)]);
    expect(r.stored()?.settled).toEqual({ sha: 's', state: 'red' });
  });

  it('settles on a green commit deeper in a burst than one walk reaches, over the next refresh', async () => {
    const r = rig(settledRed());
    const pending = Array.from({ length: 2 * ANCESTOR_ASKS_MAX }, (_, i) => `p${i}`);
    r.line(['h', ...pending, 'g', 's']);
    r.tip('h');
    for (const sha of ['h', ...pending]) r.runs(sha, [run('ci', null, 'in_progress')]);
    r.runs('g', [run('ci', 'success')]);
    r.runs(pending[ANCESTOR_ASKS_MAX + 1]!, [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 's', state: 'red' });
    expect(r.stored()?.walked).toBe(pending[ANCESTOR_ASKS_MAX - 1]);
    r.clock(REASK_MS + 1);
    await refreshDefaultBranch(r.world);
    expect(r.asked().slice(1 + ANCESTOR_ASKS_MAX)).toEqual([
      'h',
      ...pending.slice(ANCESTOR_ASKS_MAX, ANCESTOR_ASKS_MAX + 2),
      ...pending.slice(0, ANCESTOR_ASKS_MAX),
    ]);
    expect(r.stored()?.settled).toEqual({ sha: pending[ANCESTOR_ASKS_MAX + 1], state: 'green' });
    expect(r.stored()?.walked).toBeUndefined();
  });

  it('settles red on a newer commit that concluded red between two refreshes of a resumed walk', async () => {
    const r = rig({ ...settledRed('h'), head: 'pending', settled: { sha: 's', state: 'green' }, failingRuns: [] });
    const pending = Array.from({ length: 2 * ANCESTOR_ASKS_MAX }, (_, i) => `p${i}`);
    r.line(['h', ...pending, 's']);
    r.tip('h');
    for (const sha of ['h', ...pending]) r.runs(sha, [run('ci', null, 'in_progress')]);
    r.runs(pending[ANCESTOR_ASKS_MAX + 1]!, [run('ci', 'success')]);
    r.clock(REASK_MS + 1);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.walked).toBe(pending[ANCESTOR_ASKS_MAX - 1]);
    r.runs('p0', [run('ci', 'failure')]);
    r.clock(2 * (REASK_MS + 1));
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 'p0', state: 'red' });
    expect(r.stored()?.failingRuns).toEqual([{ workflow: 'ci', conclusion: 'failure', url: 'https://ci/ci' }]);
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
  });

  it('drops the resume point when the head changes and asks from the new head down', async () => {
    const r = rig({ ...settledRed('h'), head: 'pending', settled: { sha: 's', state: 'green' }, failingRuns: [] });
    const pending = Array.from({ length: 2 * ANCESTOR_ASKS_MAX }, (_, i) => `p${i}`);
    r.line(['h', ...pending, 's']);
    r.tip('h');
    for (const sha of ['h', ...pending]) r.runs(sha, [run('ci', null, 'in_progress')]);
    r.clock(REASK_MS + 1);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.walked).toBe(pending[ANCESTOR_ASKS_MAX - 1]);
    r.line(['h2', 'h', ...pending, 's']);
    r.tip('h2');
    r.runs('h2', [run('ci', null, 'in_progress')]);
    r.runs('h', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.asked().slice(ANCESTOR_ASKS_MAX + 1)).toEqual(['h2', 'h']);
    expect(r.stored()?.settled).toEqual({ sha: 'h', state: 'red' });
    expect(r.stored()?.walked).toBeUndefined();
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
  });

  it('starts the walk again from the newest once it has covered every commit down to the settled one', async () => {
    const r = rig(settledRed());
    r.line(['h', 'p0', 'p1', 's']);
    r.tip('h');
    for (const sha of ['h', 'p0', 'p1']) r.runs(sha, [run('ci', null, 'in_progress')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.walked).toBe('p1');
    r.clock(REASK_MS + 1);
    r.runs('p0', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.stored()?.settled).toEqual({ sha: 'p0', state: 'green' });
  });

  it('settles red at a red head over an older green settled commit', async () => {
    const r = rig({ ...settledRed(), settled: { sha: 's', state: 'green' }, failingRuns: [] });
    r.line(['h', 'g1', 's']);
    r.tip('h');
    r.runs('h', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.asked()).toEqual(['h']);
    expect(r.stored()?.settled).toEqual({ sha: 'h', state: 'red' });
    expect(defaultBranchRed(r.stored(), r.world.now(), WAIT)).toBe(true);
  });

  it('never moves the settled part to a commit older than the one it holds', async () => {
    const r = rig({ ...settledRed(), settled: { sha: 'g1', state: 'green' }, failingRuns: [] });
    r.line(['h', 'g1', 'r0', 's']);
    r.tip('h');
    r.runs('h', [run('ci', null, 'in_progress')]);
    r.runs('g1', [run('ci', 'success')]);
    r.runs('r0', [run('ci', 'failure')]);
    await refreshDefaultBranch(r.world);
    expect(r.asked()).toEqual(['h']);
    expect(r.stored()?.settled).toEqual({ sha: 'g1', state: 'green' });
  });

  it('walks nothing where the head concluded', async () => {
    const r = rig(settledRed());
    r.line(['h', 'g1', 's']);
    r.tip('h');
    r.runs('h', [run('ci', 'success')]);
    await refreshDefaultBranch(r.world);
    expect(r.asked()).toEqual(['h']);
    expect(r.stored()?.settled).toEqual({ sha: 'h', state: 'green' });
  });
});

describe('refreshOnChange — reads the tip only where it may have moved', () => {
  const counted = (r: Rig): { world: DefaultBranchWorld; tips: () => number } => {
    let tips = 0;
    const world: DefaultBranchWorld = {
      ...r.world,
      refs: {
        ...r.world.refs,
        remoteSha: async (branch) => {
          tips += 1;
          return r.world.refs.remoteSha(branch);
        },
      },
    };
    return { world, tips: () => tips };
  };

  it('reads no tip on a beat whose key did not change and whose reading is not due', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    const c = counted(r);
    const refresh = refreshOnChange(c.world, async () => 'k1');
    expect(await refresh()).toBe('asked');
    r.clock(60_000);
    expect(await refresh()).toBe('skipped');
    expect(c.tips()).toBe(1);
  });

  it('reads the tip again when the key changes', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    r.runs('a2', [run('ci', 'success')]);
    const c = counted(r);
    let key = 'k1';
    const refresh = refreshOnChange(c.world, async () => key);
    await refresh();
    key = 'k2';
    r.tip('a2');
    expect(await refresh()).toBe('asked');
    expect(c.tips()).toBe(2);
    expect(r.stored()).toMatchObject({ headSha: 'a2' });
  });

  it('reads the tip again when the held reading is due, whatever the key', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    const c = counted(r);
    const refresh = refreshOnChange(c.world, async () => 'k1');
    await refresh();
    r.clock(WAIT / 2);
    expect(await refresh()).toBe('asked');
    expect(c.tips()).toBe(2);
  });

  it('reads the tip on every beat where the key is unknown', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    const c = counted(r);
    const refresh = refreshOnChange(c.world, async () => null);
    await refresh();
    await refresh();
    expect(c.tips()).toBe(2);
  });

  it('reads no tip on any beat where no CI system is declared', async () => {
    const r = rig();
    const c = counted(r);
    c.world.build = { ...c.world.build, system: () => '' };
    const refresh = refreshOnChange(c.world, async () => 'k1');
    expect(await refresh()).toBe('unreadable');
    r.clock(WAIT);
    expect(await refresh()).toBe('unreadable');
    expect(c.tips()).toBe(0);
  });

  it('keeps no key after an unreadable tip, so the next beat reads again', async () => {
    const r = rig();
    r.runs('a1', [run('ci', 'success')]);
    const c = counted(r);
    const refresh = refreshOnChange(c.world, async () => 'k1');
    await refresh();
    r.clock(WAIT / 2);
    r.tip(null);
    expect(await refresh()).toBe('unreadable');
    r.tip('a1');
    r.clock(WAIT / 2 + 60_000);
    await refresh();
    expect(c.tips()).toBe(3);
  });
});

interface BaseRig {
  world: BaseRefreshWorld;
  files: Map<string, DefaultBranchReading>;
  records: Map<string, RepairRecord>;
  removed: string[];
  asked: string[];
  warnings: string[];
  runs: Record<string, WorkflowShaRun[]>;
  throwOn: Set<string>;
}

const baseRig = (held: readonly string[] | null = []): BaseRig => {
  const files = new Map<string, DefaultBranchReading>();
  const records = new Map<string, RepairRecord>();
  const removed: string[] = [];
  const asked: string[] = [];
  const warnings: string[] = [];
  const runs: Record<string, WorkflowShaRun[]> = {};
  const throwOn = new Set<string>();
  const world: BaseRefreshWorld = {
    shared: {
      refs: {
        remoteSha: async () => ({ ok: true, value: 'unknown' }),
        firstParentLine: async () => ({ ok: true, value: [] }),
      },
      build: {
        system: () => 'github-actions',
        runsForSha: async (branch, sha) => {
          if (throwOn.has(branch)) throw new Error('boom');
          asked.push(`${branch}@${sha}`);
          return { ok: true, value: runs[sha] ?? [] };
        },
      },
      slot: (call) => call(),
      now: () => T0,
      checksWaitMs: WAIT,
      checks: ['CI'],
    },
    storeFor: (base) => ({
      read: async () => ({ ok: true, value: files.get(base) ?? null }),
      write: async (reading) => {
        files.set(base, reading);
        return { ok: true, value: undefined };
      },
    }),
    repairFor: (base) => ({
      read: async () => ({ ok: true, value: records.get(base) ?? null }),
      write: async (record) => {
        records.set(base, record);
        return { ok: true, value: undefined };
      },
    }),
    held: async () => held,
    remove: async (base) => {
      removed.push(base);
      return true;
    },
  };
  return { world, files, records, removed, asked, warnings, runs, throwOn };
};

describe('refreshBases', () => {
  describe('the base repair record', () => {
    const green = (r: BaseRig, sha: string) => {
      r.runs[sha] = [run('CI', 'success')];
    };
    const beat = (r: BaseRig, tips: Record<string, string>) => refreshBases(r.world, tips, (l) => r.warnings.push(l));

    it('opens a record for the base on a green-to-red change, with that base\'s last green SHA', async () => {
      const r = baseRig();
      green(r, 's1');
      await beat(r, { 'sprint/x': 's1' });
      r.world.shared.now = () => T0 + 1000;
      r.runs.s2 = [run('CI', 'failure')];
      await beat(r, { 'sprint/x': 's2' });
      expect(r.records.get('sprint/x')).toMatchObject({ branch: 'sprint/x', lastGreenSha: 's1' });
    });

    it('keeps the record on disk across a second beat while the base stays red', async () => {
      const r = baseRig();
      green(r, 's1');
      await beat(r, { 'sprint/x': 's1' });
      r.runs.s2 = [run('CI', 'failure')];
      await beat(r, { 'sprint/x': 's2' });
      await beat(r, { 'sprint/x': 's2' });
      expect(r.records.get('sprint/x')).toMatchObject({ branch: 'sprint/x', lastGreenSha: 's1' });
    });

    it('opens no record for a base with no reading', async () => {
      const r = baseRig();
      await beat(r, { 'sprint/x': 's1' });
      expect(r.records.size).toBe(0);
    });

    it('removes the record with the reading when the listing drops the base', async () => {
      const r = baseRig(['sprint/x']);
      r.runs.s1 = [run('CI', 'failure')];
      await beat(r, { 'sprint/x': 's1' });
      await beat(r, {});
      expect(r.removed).toEqual(['sprint/x']);
    });
  });

  it('writes one reading per sprint base, named for the base', async () => {
    const r = baseRig();
    r.runs.s1 = [run('CI', 'failure')];
    await refreshBases(r.world, { 'sprint/x': 's1', main: 'm1', 'feature/y': 'f1' }, (l) => r.warnings.push(l));
    expect([...r.files.keys()]).toEqual(['sprint/x']);
    expect(r.files.get('sprint/x')).toMatchObject({ branch: 'sprint/x', headSha: 's1', head: 'red' });
    expect(r.asked).toEqual(['sprint/x@s1']);
  });

  it('never touches the default branch\'s repair store or the snapshot record', async () => {
    const r = baseRig();
    (r.world.shared as DefaultBranchWorld).record = () => {
      throw new Error('record called');
    };
    (r.world.shared as DefaultBranchWorld).repair = {
      read: async () => {
        throw new Error('repair read');
      },
      write: async () => {
        throw new Error('repair write');
      },
    };
    r.runs.s1 = [run('CI', 'failure')];
    await refreshBases(r.world, { 'sprint/x': 's1' }, (l) => r.warnings.push(l));
    expect(r.files.get('sprint/x')).toMatchObject({ head: 'red', settled: { sha: 's1', state: 'red' } });
    expect(r.records.get('sprint/x')).toMatchObject({ branch: 'sprint/x' });
    expect(r.warnings.filter((l) => !l.includes('no last green SHA'))).toEqual([]);
  });

  it('does not warn that a declared check matched no run for a base with no runs', async () => {
    const r = baseRig();
    await refreshBases(r.world, { 'sprint/x': 's1', 'sprint/y': 's2' }, (l) => r.warnings.push(l));
    expect(r.warnings.filter((l) => l.includes('matched no run'))).toEqual([]);
    expect(r.files.get('sprint/x')).toMatchObject({ head: 'unknown' });
  });

  it('refreshes the next base after one throws', async () => {
    const r = baseRig();
    r.throwOn.add('sprint/a');
    r.runs.s2 = [run('CI', 'success')];
    const out = await refreshBases(r.world, { 'sprint/a': 's1', 'sprint/b': 's2' }, (l) => r.warnings.push(l));
    expect(out).toEqual({ 'sprint/a': 'failed', 'sprint/b': 'asked' });
    expect(r.files.has('sprint/a')).toBe(false);
    expect(r.files.get('sprint/b')).toMatchObject({ head: 'green' });
    expect(r.warnings.some((l) => l.includes("'sprint/a' failed: boom"))).toBe(true);
  });

  it('removes the file of a sprint base the listing no longer names, and only that file', async () => {
    const r = baseRig(['sprint/gone', 'sprint/x', 'other/y']);
    await refreshBases(r.world, { 'sprint/x': 's1' });
    expect(r.removed).toEqual(['sprint/gone']);
  });

  it('removes nothing where the held files could not be listed', async () => {
    const r = baseRig(null);
    await refreshBases(r.world, {});
    expect(r.removed).toEqual([]);
  });
});

describe('refreshWithBases', () => {
  it('refreshes no base and removes no file where the refresh read no listing', async () => {
    const r = baseRig(['sprint/gone']);
    let refreshed = 0;
    const beat = refreshWithBases(async () => { refreshed += 1; }, () => null, r.world);
    await beat();
    expect(refreshed).toBe(1);
    expect(r.removed).toEqual([]);
    expect(r.asked).toEqual([]);
    expect(r.files.size).toBe(0);
  });

  it('keeps the listing of this pass only', async () => {
    const r = baseRig(['sprint/gone']);
    let tips: Record<string, string> | null = null;
    const take = () => {
      const t = tips;
      tips = null;
      return t;
    };
    const beat = refreshWithBases(async () => { tips = { 'sprint/x': 's1' }; }, take, r.world);
    await beat();
    expect(r.removed).toEqual(['sprint/gone']);
    expect(r.asked).toEqual(['sprint/x@s1']);
  });

  it('starts no process while the default branch refresh skips, with a sprint branch on origin', async () => {
    // An idle pass: the key is unchanged and the held reading is not due, so the
    // refresh reads no tip, and the combined listing is never asked.
    const d = rig();
    d.runs('a1', [run('ci', 'success')]);
    let listings = 0;
    const world: DefaultBranchWorld = {
      ...d.world,
      refs: {
        ...d.world.refs,
        remoteSha: async () => {
          listings += 1;
          return { ok: true, value: { sha: 'a1' } };
        },
      },
    };
    const refresh = refreshOnChange(world, async () => 'k');
    const r = baseRig();
    const beat = refreshWithBases(refresh, () => (listings > 0 ? { 'sprint/x': 's1' } : null), r.world);
    await beat();
    const afterFirst = listings;
    await beat();
    expect(afterFirst).toBe(1);
    expect(listings).toBe(1);
  });

  it('writes no reading and deletes no file where the listing failed', async () => {
    const r = baseRig(['sprint/x']);
    const beat = refreshWithBases(async () => undefined, () => null, r.world);
    await beat();
    expect(r.files.size).toBe(0);
    expect(r.removed).toEqual([]);
  });
});

describe('refreshDefaultBranch for a base', () => {
  it('writes a red reading for a sprint branch with no repair store and no repair record', async () => {
    const r = rig();
    const writes: DefaultBranchReading[] = [];
    const world: DefaultBranchWorld = {
      ...r.world,
      branch: async () => 'sprint/x',
      refs: { ...r.world.refs, remoteSha: async () => ({ ok: true, value: { sha: 'a1' } }) },
      store: { read: async () => ({ ok: true, value: null }), write: async (v) => (writes.push(v), { ok: true, value: undefined }) },
    };
    delete world.repair;
    r.runs('a1', [run('ci', 'failure')]);
    await refreshDefaultBranch(world);
    expect(writes[0]).toMatchObject({ branch: 'sprint/x', head: 'red' });
    expect(r.repair()).toBeNull();
  });
});
