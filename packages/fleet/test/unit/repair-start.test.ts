import { describe, expect, it } from 'vitest';

import type { WorkflowShaRun } from '@plot-pm/domain/entities/build';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '@plot-pm/domain/entities/repair-record';
import type { Pr } from '@plot-pm/domain/entities/pr';
import type { PortResult } from '@plot-pm/domain';
import { RERUN_GRACE_MS, type RoleRunReading } from '@plot-pm/domain/rules/repair-start';

import { repairStartTick, type RepairStartWorld } from '../../src/shared/repair-start.js';

const T0 = Date.parse('2026-10-30T10:00:00.000Z');
const GREEN = 'g'.repeat(40);
const RED = 'r'.repeat(40);
const BRANCH = `bug/main-repair-${GREEN.slice(0, 12)}`;

const reading = (): DefaultBranchReading => ({
  v: DEFAULT_BRANCH_VERSION,
  branch: 'main',
  headSha: RED,
  head: 'red',
  settled: { sha: RED, state: 'red' },
  failingRuns: [],
  headSince: new Date(T0).toISOString(),
  askedAt: new Date(T0).toISOString(),
  at: new Date(T0).toISOString(),
});

const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'idle',
  lastGreenSha: GREEN,
  firstRedSha: RED,
  redSince: new Date(T0).toISOString(),
  candidates: [],
  rerun: 'none',
  preRevertRerun: 'none',
  at: new Date(T0).toISOString(),
  ...over,
});

const run = (conclusion: string | null): WorkflowShaRun =>
  ({ sha: RED, workflow: 'CI', status: conclusion === null ? 'in_progress' : 'completed', conclusion, url: '', startedAt: '' }) as WorkflowShaRun;

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });
const failed = <T>(): PortResult<T> => ({ ok: false, why: 'failed' });
const unaskable = <T>(): PortResult<T> => ({ ok: false, why: 'unaskable' });

interface Rig {
  world: RepairStartWorld;
  stored: () => RepairRecord | null;
  calls: string[];
  set: (patch: Partial<Rigging>) => void;
}

interface Rigging {
  now: number;
  runs: PortResult<readonly WorkflowShaRun[]>;
  rerun: PortResult<null>;
  pr: PortResult<Pr | null>;
  claim: 'won' | 'lost' | 'failed';
  desk: boolean;
  run: RoleRunReading;
  base: string | null;
  role: 'started' | 'failed';
}

const rig = (initial: RepairRecord | null, now = T0): Rig => {
  let file = initial;
  const calls: string[] = [];
  const state: Rigging = {
    now,
    runs: answered([run('failure')]),
    rerun: answered(null),
    pr: answered(null),
    claim: 'won',
    desk: false,
    run: 'none',
    base: 'b'.repeat(40),
    role: 'started',
  };
  const world: RepairStartWorld = {
    reading: async () => reading(),
    repair: {
      read: async () => answered(file),
      write: async (next) => {
        file = next;
        calls.push('write');
        return answered(undefined);
      },
    },
    refs: { contains: async () => answered('yes') },
    build: {
      runsForSha: async () => state.runs,
      rerunFailed: async () => {
        calls.push('rerun');
        return state.rerun;
      },
    },
    host: { prState: async () => state.pr },
    baseSha: async () => state.base,
    claim: async () => {
      calls.push('claim');
      return state.claim;
    },
    hasDesk: async () => state.desk,
    startRole: async () => {
      calls.push('role');
      return state.role;
    },
    roleRun: () => state.run,
    slot: (call) => call(),
    now: () => state.now,
    checksWaitMs: 3_600_000,
    mainRepairBoundMs: 3_600_000,
    checks: ['CI'],
  };
  return { world, stored: () => file, calls, set: (patch) => Object.assign(state, patch) };
};

const pr = (over: Partial<Pr> = {}): Pr =>
  ({ number: 7, head: BRANCH, state: 'OPEN', headSha: 'c'.repeat(40), ...over }) as Pr;

describe('repairStartTick — the re-run', () => {
  it('re-runs the first red SHA once and records the ask', async () => {
    const r = rig(record());
    expect(await repairStartTick(r.world)).toBe('rerun-asked');
    expect(r.stored()).toMatchObject({ state: 'rerun', rerun: 'asked' });
    expect(await repairStartTick(r.world)).toBe('awaiting-rerun');
    expect(r.calls.filter((c) => c === 'rerun')).toHaveLength(1);
  });

  it('holds and writes nothing where CI cannot accept the re-run', async () => {
    const r = rig(record());
    r.set({ rerun: unaskable() });
    expect(await repairStartTick(r.world)).toBe('held');
    expect(r.stored()).toMatchObject({ state: 'idle', rerun: 'none' });
    r.set({ rerun: failed() });
    expect(await repairStartTick(r.world)).toBe('held');
  });

  it('keeps waiting while the re-run is inside the grace window', async () => {
    const asked = record({ state: 'rerun', rerun: 'asked' });
    const r = rig(asked, T0 + RERUN_GRACE_MS - 1);
    expect(await repairStartTick(r.world)).toBe('awaiting-rerun');
    expect(r.calls).toEqual([]);
  });
});

describe('repairStartTick — the claim', () => {
  const settledRed = (): RepairRecord => record({ state: 'rerun', rerun: 'asked' });
  const later = T0 + RERUN_GRACE_MS + 1;

  it('claims before it starts the role, and records the attempt', async () => {
    const r = rig(settledRed(), later);
    expect(await repairStartTick(r.world)).toBe('role-started');
    expect(r.calls).toEqual(['write', 'claim', 'role']);
    expect(r.stored()).toMatchObject({ state: 'repairing', attempt: { branch: BRANCH } });
  });

  it('starts nothing where the claim is lost', async () => {
    const r = rig(settledRed(), later);
    r.set({ claim: 'lost' });
    expect(await repairStartTick(r.world)).toBe('claim-lost');
    expect(r.calls).not.toContain('role');
  });

  it('starts nothing where the claim could not be pushed', async () => {
    const r = rig(settledRed(), later);
    r.set({ claim: 'failed' });
    expect(await repairStartTick(r.world)).toBe('claim-failed');
    expect(r.calls).not.toContain('role');
  });

  it('holds where the default branch tip cannot be read', async () => {
    const r = rig(settledRed(), later);
    r.set({ base: null });
    expect(await repairStartTick(r.world)).toBe('held');
    expect(r.calls).not.toContain('claim');
  });

  it('holds an episode with no last green SHA', async () => {
    const r = rig(record({ state: 'rerun', rerun: 'asked', lastGreenSha: undefined }), later);
    expect(await repairStartTick(r.world)).toBe('held');
    expect(r.calls).toEqual([]);
  });

  it('resumes a desk it holds without claiming again', async () => {
    const r = rig(record({ state: 'repairing', rerun: 'asked', attempt: { branch: BRANCH } }), later);
    r.set({ desk: true });
    expect(await repairStartTick(r.world)).toBe('role-started');
    expect(r.calls).toEqual(['role']);
  });
});

describe('repairStartTick — the fix PR', () => {
  const repairing = (): RepairRecord => record({ state: 'repairing', rerun: 'asked', attempt: { branch: BRANCH } });
  const later = T0 + RERUN_GRACE_MS + 1;

  it('waits while no PR exists and the role runs', async () => {
    const r = rig(repairing(), later);
    r.set({ run: 'alive' });
    expect(await repairStartTick(r.world)).toBe('awaiting-repair');
    expect(r.calls).toEqual([]);
  });

  it('records the fix PR once and starts no review of its own', async () => {
    const r = rig(repairing(), later);
    r.set({ pr: answered(pr()) });
    expect(await repairStartTick(r.world)).toBe('pr-recorded');
    expect(r.stored()?.repairPr).toBe(7);
    expect(r.calls).toEqual(['write']);
    expect(await repairStartTick(r.world)).toBe('awaiting-repair');
    expect(r.calls).toEqual(['write']);
  });

  it('records no fix PR on a machine that lost the claim', async () => {
    const r = rig(record({ state: 'repairing', rerun: 'asked', attempt: { branch: BRANCH, outcome: 'lost' } }), later);
    r.set({ pr: answered(pr()) });
    expect(await repairStartTick(r.world)).toBe('awaiting-repair');
    expect(r.stored()?.repairPr).toBeUndefined();
    expect(r.calls).toEqual([]);
  });

  it('holds where the host cannot be asked about the branch', async () => {
    const r = rig(repairing(), later);
    r.set({ pr: unaskable() });
    expect(await repairStartTick(r.world)).toBe('held');
    expect(r.calls).toEqual([]);
  });

  it('does nothing where no episode is recorded', async () => {
    const r = rig(null);
    expect(await repairStartTick(r.world)).toBe('none');
  });
});

describe('repairStartTick — one attempt per episode', () => {
  const repairing = (over: Partial<RepairRecord['attempt']> = {}): RepairRecord =>
    record({ state: 'repairing', rerun: 'asked', attempt: { branch: BRANCH, ...over } });
  const later = T0 + RERUN_GRACE_MS + 1;

  it('records a lost claim and starts nothing on the next pass', async () => {
    const r = rig(record({ state: 'rerun', rerun: 'asked' }), later);
    r.set({ claim: 'lost' });
    expect(await repairStartTick(r.world)).toBe('claim-lost');
    expect(r.stored()?.attempt).toEqual({ branch: BRANCH, outcome: 'lost' });
    expect(await repairStartTick(r.world)).toBe('claim-lost');
    expect(r.calls.filter((c) => c === 'claim')).toHaveLength(1);
    expect(r.calls).not.toContain('role');
  });

  it('ends the attempt where the role ended with no PR, and starts no second run', async () => {
    const r = rig(repairing(), later);
    r.set({ desk: true, run: 'ended' });
    expect(await repairStartTick(r.world)).toBe('attempt-ended');
    expect(r.stored()?.attempt).toEqual({ branch: BRANCH, outcome: 'ended' });
    r.set({ run: 'none' });
    expect(await repairStartTick(r.world)).toBe('attempt-ended');
    expect(r.calls).not.toContain('role');
    expect(r.calls).not.toContain('claim');
  });

  it('starts no second run once the fix PR is closed', async () => {
    const r = rig(repairing(), later);
    r.set({ desk: true, run: 'ended', pr: answered(pr({ state: 'CLOSED' })) });
    expect(await repairStartTick(r.world)).toBe('attempt-ended');
    expect(await repairStartTick(r.world)).toBe('attempt-ended');
    expect(r.calls).not.toContain('role');
  });

  it('resumes a run that crashed with no ending record once, then ends the attempt', async () => {
    const r = rig(repairing(), later);
    r.set({ desk: true, run: 'crashed' });
    expect(await repairStartTick(r.world)).toBe('role-resumed');
    expect(r.stored()?.attempt).toEqual({ branch: BRANCH, resumed: true });
    expect(await repairStartTick(r.world)).toBe('attempt-ended');
    expect(r.stored()?.attempt).toEqual({ branch: BRANCH, resumed: true, outcome: 'ended' });
    expect(await repairStartTick(r.world)).toBe('attempt-ended');
    expect(r.calls.filter((c) => c === 'role')).toHaveLength(1);
  });
});
