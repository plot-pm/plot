import { describe, expect, it } from 'vitest';

import type { PortResult } from '@plot-pm/domain';
import type { WorkflowShaRun } from '@plot-pm/domain/entities/build';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { Pr } from '@plot-pm/domain/entities/pr';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '@plot-pm/domain/entities/repair-record';
import type { TicketRecord } from '@plot-pm/domain/entities/ticket-record';

import { repairRevertTick, type RevertWorld } from '../../src/shared/revert-start.js';

const T0 = Date.parse('2026-10-30T10:00:00.000Z');
const HOUR = 3_600_000;
const GREEN = 'g'.repeat(40);
const RED = 'r'.repeat(40);
const BREAKING = 'c'.repeat(40);
const SUBJECT = 'Merge pull request #41 from o/feature/the-thing';
const REVERT_BRANCH = 'bug/revert-41';
const REVERT_MERGE = 'm'.repeat(40);

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });

const reading = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
  v: DEFAULT_BRANCH_VERSION,
  branch: 'main',
  headSha: RED,
  head: 'red',
  settled: { sha: RED, state: 'red' },
  failingRuns: [],
  headSince: new Date(T0).toISOString(),
  askedAt: new Date(T0).toISOString(),
  at: new Date(T0).toISOString(),
  ...over,
});

const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'repairing',
  lastGreenSha: GREEN,
  firstRedSha: RED,
  redSince: new Date(T0).toISOString(),
  candidates: [{ sha: BREAKING, subject: SUBJECT }],
  rerun: 'asked',
  preRevertRerun: 'none',
  attempt: 'started',
  repairPr: 5,
  at: new Date(T0).toISOString(),
  ...over,
});

const run = (sha: string, conclusion: string | null, startedAt = ''): WorkflowShaRun =>
  ({ sha, workflow: 'CI', status: conclusion === null ? 'in_progress' : 'completed', conclusion, url: '', startedAt }) as WorkflowShaRun;

/** The last green SHA's own runs, which concluded before the episode opened. */
const OLD_GREEN_START = new Date(T0 - HOUR).toISOString();

const pr = (over: Partial<Pr> = {}): Pr =>
  ({ number: 9, head: REVERT_BRANCH, state: 'OPEN', checks: 'pending', headSha: 'd'.repeat(40), url: '', mergeCommit: '', ...over }) as Pr;

interface Rigging {
  now: number;
  reading: DefaultBranchReading | null;
  runs: Map<string, readonly WorkflowShaRun[]>;
  prs: Map<string | number, Pr | null>;
  revert: 'reverted' | 'conflict';
  claim: 'won' | 'lost' | 'failed';
  desk: string | null;
  onMain: 'yes' | 'no' | 'unknown';
  reverted: boolean;
  reviewFailed: boolean;
  ticket: TicketRecord | 'none';
  descends: 'yes' | 'no' | 'unknown';
  settledHasRevert: 'yes' | 'no' | 'unknown';
  /** How the last green SHA's new attempt concludes once a full re-run is asked. */
  greenRerun: 'success' | 'failure';
  /** Where true, every candidate read fails. */
  candidateFails: boolean;
  /** Where true, the next desk is not made. */
  deskFails: boolean;
  /** Where true, a review start is refused (another review holds the one slot). */
  reviewRefused: boolean;
  /** The checks a PR reads where they are not asked for: Bitbucket under Jenkins answers `unknown`. */
  checksWithout: 'as-set' | 'unknown';
}

const rig = (initial: RepairRecord, now = T0 + 2 * HOUR) => {
  let file: RepairRecord | null = initial;
  let ticket: TicketRecord | 'none';
  const calls: string[] = [];
  const notes: string[] = [];
  const opened: { title: string; body: string; labels: readonly string[] }[] = [];
  const state: Rigging = {
    now,
    reading: reading(),
    runs: new Map([
      [RED, [run(RED, 'failure')]],
      [GREEN, [run(GREEN, 'success', OLD_GREEN_START)]],
      [BREAKING, [run(BREAKING, 'failure')]],
    ]),
    prs: new Map(),
    revert: 'reverted',
    claim: 'won',
    desk: null,
    onMain: 'yes',
    reverted: false,
    reviewFailed: false,
    ticket: 'none',
    descends: 'yes',
    settledHasRevert: 'no',
    greenRerun: 'success',
    candidateFails: false,
    deskFails: false,
    reviewRefused: false,
    checksWithout: 'as-set',
  };
  const started: string[] = [];
  ticket = state.ticket;
  const world: RevertWorld = {
    reading: async () => state.reading,
    repair: {
      read: async () => answered(file),
      write: async (next) => {
        file = next;
        calls.push(`write:${next.state}`);
        return answered(undefined);
      },
    },
    refs: {
      contains: async (a) =>
        a === BREAKING ? answered(state.onMain) : a === REVERT_MERGE ? answered(state.settledHasRevert) : answered(state.descends),
      defaultBranch: async () => answered('main'),
    },
    build: {
      runsForSha: async (_branch, sha) => answered(state.runs.get(sha) ?? []),
      // A full re-run starts a new attempt of every run; a failed-only re-run of a green SHA would start none.
      rerunAll: async (_branch, sha) => {
        calls.push(`rerun:${sha === GREEN ? 'green' : 'red'}`);
        state.runs.set(sha, [run(sha, state.greenRerun, new Date(state.now).toISOString())]);
        return answered(null);
      },
    },
    host: {
      prState: async (key, opts) => {
        const found = state.prs.get(key) ?? null;
        if (found === null || opts?.withChecks === true || state.checksWithout === 'as-set') return answered(found);
        return answered({ ...found, checks: 'unknown' } as Pr);
      },
      prCreate: async (input) => {
        calls.push(`pr-create:${input.head}`);
        state.prs.set(input.head, pr());
        return answered('https://example/pull/9');
      },
      prClose: async (number) => {
        calls.push(`pr-close:${number}`);
        return answered(undefined);
      },
    },
    revert: {
      isReverted: async (_sha, ref) => answered(ref === 'main' || ref === 'origin/main' ? false : state.reverted),
      revertCommit: async () => {
        calls.push('revert-commit');
        if (state.revert === 'reverted') state.reverted = true;
        return answered(state.revert);
      },
    },
    candidate: async (commit) =>
      state.candidateFails
        ? null
        : {
            ...commit,
            prMerged: true,
            hostMergeCommit: commit.sha,
            settledRed: true,
            touchesState: false,
          },
    baseSha: async () => 'b'.repeat(40),
    claim: async () => {
      calls.push('claim');
      return state.claim;
    },
    deskOf: async () => state.desk,
    makeDesk: async () => {
      calls.push('desk');
      if (state.deskFails) return null;
      state.desk = '/desk/revert';
      return state.desk;
    },
    push: async () => {
      calls.push('push');
      return true;
    },
    reviewFailed: async () => state.reviewFailed,
    reviewStarted: async (n, head) => started.includes(`${n}@${head}`),
    startReview: async (n, head) => {
      calls.push(`review:${n}`);
      if (state.reviewRefused) return false;
      started.push(`${n}@${head}`);
      return true;
    },
    tickets: {
      read: async () => answered(ticket),
      write: async (_n, next) => {
        ticket = next;
        calls.push(`ticket:${next.ticket}`);
        return answered(undefined);
      },
      clear: async () => {
        ticket = 'none';
        return answered(undefined);
      },
    },
    tracker: {
      issueOpen: async (input) => {
        opened.push(input);
        return answered({ id: 'T-1' });
      },
      issueComment: async () => answered(undefined),
    },
    notify: async (message) => {
      notes.push(message);
    },
    slot: (call) => call(),
    now: () => state.now,
    checksWaitMs: 100 * HOUR,
    mainRepairBoundMs: HOUR,
    checks: ['CI'],
  } as unknown as RevertWorld;
  return { world, stored: () => file, calls, notes, opened, set: (patch: Partial<Rigging>) => Object.assign(state, patch), state };
};

describe('repairRevertTick — the arc to an open revert PR', () => {
  it('re-runs the last green SHA once, then opens the revert PR after it reads green', async () => {
    const r = rig(record());
    expect(await repairRevertTick(r.world)).toBe('rerun-asked');
    expect(r.stored()).toMatchObject({ state: 'reverting', preRevertRerun: 'asked' });
    r.set({ now: r.state.now + 30 * 60_000 });
    expect(await repairRevertTick(r.world)).toBe('revert-opened');
    const order = ['claim', 'desk', 'revert-commit', 'push', `pr-create:${REVERT_BRANCH}`, 'review:9'];
    expect(order.map((step) => r.calls.indexOf(step))).toEqual([...order.map((step) => r.calls.indexOf(step))].sort((x, y) => x - y));
    expect(order.every((step) => r.calls.includes(step))).toBe(true);
    expect(r.calls.indexOf('claim')).toBeLessThan(r.calls.indexOf('revert-commit'));
    expect(r.calls).toContain('review:9');
    expect(r.stored()).toMatchObject({ revertPr: 9 });
  });
});

describe('repairRevertTick — the last green re-run', () => {
  it('asks a full re-run and exhausts when the new attempt of the last green SHA reads red', async () => {
    const r = rig(record());
    r.set({ greenRerun: 'failure' });
    expect(await repairRevertTick(r.world)).toBe('rerun-asked');
    expect(r.calls).toContain('rerun:green');
    r.set({ now: r.state.now + 30 * 60_000 });
    expect(await repairRevertTick(r.world)).toBe('exhausted');
    expect(r.notes[0]).toContain('the last green SHA reads red on a re-run');
    expect(r.calls).not.toContain('claim');
  });

  it('never reverts on the old green attempt where the re-run started no new one', async () => {
    const r = rig(record());
    // A failed-only re-run of a green SHA re-runs nothing: the old runs stay.
    r.world.build.rerunAll = async () => answered(null);
    expect(await repairRevertTick(r.world)).toBe('rerun-asked');
    r.set({ now: r.state.now + 30 * 60_000 });
    expect(await repairRevertTick(r.world)).toBe('awaiting-rerun');
    expect(r.calls).not.toContain('claim');
    expect(r.stored()?.revertPr).toBeUndefined();
  });
});

describe('repairRevertTick — a failed read holds', () => {
  it('holds, and does not exhaust, where a candidate commit could not be read', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked' }));
    r.state.runs.set(GREEN, [run(GREEN, 'success', new Date(T0 + 2 * HOUR).toISOString())]);
    r.set({ candidateFails: true, now: T0 + 3 * HOUR });
    expect(await repairRevertTick(r.world)).toBe('held');
    expect(r.stored()?.state).toBe('reverting');
    expect(r.notes).toHaveLength(0);
    r.set({ candidateFails: false });
    expect(await repairRevertTick(r.world)).toBe('revert-opened');
  });

  it('makes the desk on a later pass after a won claim, without a second claim', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked' }));
    r.state.runs.set(GREEN, [run(GREEN, 'success', new Date(T0 + 2 * HOUR).toISOString())]);
    r.set({ deskFails: true, now: T0 + 3 * HOUR });
    expect(await repairRevertTick(r.world)).toBe('held');
    expect(r.stored()).toMatchObject({ state: 'reverting', revertClaimed: true });
    // The claim branch now exists on origin: a second claim would lose.
    r.set({ deskFails: false, claim: 'lost', now: r.state.now + 2 * 60_000 });
    expect(await repairRevertTick(r.world)).toBe('revert-opened');
    expect(r.calls.filter((c) => c === 'claim')).toHaveLength(1);
    expect(r.stored()).toMatchObject({ revertPr: 9, revertClaimed: true });
  });
});

describe('repairRevertTick — the revert PR', () => {
  it('asks for the checks, so a red revert PR on Bitbucket under Jenkins exhausts', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked', revertPr: 9 }));
    r.set({ checksWithout: 'unknown' });
    r.state.prs.set(9, pr({ checks: 'failing' }));
    expect(await repairRevertTick(r.world)).toBe('exhausted');
  });

  it('creates the revert PR inside a host slot', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked' }));
    r.state.runs.set(GREEN, [run(GREEN, 'success', new Date(T0 + 2 * HOUR).toISOString())]);
    r.set({ now: T0 + 3 * HOUR });
    let inSlot = false;
    const create = r.world.host.prCreate;
    r.world.slot = async (call) => {
      inSlot = true;
      try {
        return await call();
      } finally {
        inSlot = false;
      }
    };
    r.world.host.prCreate = async (input) => {
      r.calls.push(`pr-create-in-slot:${inSlot}`);
      return create(input);
    };
    expect(await repairRevertTick(r.world)).toBe('revert-opened');
    expect(r.calls).toContain('pr-create-in-slot:true');
  });

  it('starts the review again on a later pass where the first start was refused', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked' }));
    r.state.runs.set(GREEN, [run(GREEN, 'success', new Date(T0 + 2 * HOUR).toISOString())]);
    r.set({ reviewRefused: true, now: T0 + 3 * HOUR });
    expect(await repairRevertTick(r.world)).toBe('revert-opened');
    expect(r.calls.filter((c) => c === 'review:9')).toHaveLength(1);
    r.state.prs.set(9, pr());
    r.set({ reviewRefused: false });
    expect(await repairRevertTick(r.world)).toBe('awaiting-revert');
    expect(r.calls.filter((c) => c === 'review:9')).toHaveLength(2);
    expect(await repairRevertTick(r.world)).toBe('awaiting-revert');
    expect(r.calls.filter((c) => c === 'review:9')).toHaveLength(2);
  });
});

describe('repairRevertTick — exhausted', () => {
  it('ends a conflicting revert at exhausted with one notification and no second attempt', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked' }));
    r.state.runs.set(GREEN, [run(GREEN, 'success', new Date(T0 + 2 * HOUR).toISOString())]);
    r.set({ revert: 'conflict', now: T0 + 3 * HOUR });
    expect(await repairRevertTick(r.world)).toBe('exhausted');
    expect(r.stored()?.state).toBe('exhausted');
    expect(await repairRevertTick(r.world)).toBe('none');
    expect(r.notes).toHaveLength(1);
    expect(r.calls.filter((c) => c === 'revert-commit')).toHaveLength(1);
  });

  it('ends at exhausted where the picker answers unknown', async () => {
    const r = rig(record({ candidates: [] }));
    expect(await repairRevertTick(r.world)).toBe('exhausted');
    expect(r.notes).toHaveLength(1);
    expect(r.calls).not.toContain('claim');
  });

  it('keeps the episode open while the revert PR is open, and exhausts on a red one or a HIGH', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked', revertPr: 9 }));
    r.state.prs.set(9, pr());
    expect(await repairRevertTick(r.world)).toBe('awaiting-revert');
    r.state.prs.set(9, pr({ checks: 'failing' }));
    expect(await repairRevertTick(r.world)).toBe('exhausted');
    expect(r.notes).toHaveLength(1);

    const high = rig(record({ state: 'reverting', preRevertRerun: 'asked', revertPr: 9 }));
    high.state.prs.set(9, pr());
    high.set({ reviewFailed: true });
    expect(await repairRevertTick(high.world)).toBe('exhausted');
  });

  it('awaits a merged revert until the settled commit contains it, then exhausts if main still reads red', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked', revertPr: 9 }));
    r.state.prs.set(9, pr({ state: 'MERGED', mergeCommit: REVERT_MERGE }));
    r.set({ reading: reading({ headSha: REVERT_MERGE, head: 'pending' }), settledHasRevert: 'no' });
    expect(await repairRevertTick(r.world)).toBe('awaiting-revert');
    expect(r.stored()?.state).toBe('reverting');
    expect(r.notes).toHaveLength(0);

    const after = 'n'.repeat(40);
    r.set({ reading: reading({ headSha: after, settled: { sha: after, state: 'red' } }), settledHasRevert: 'yes' });
    expect(await repairRevertTick(r.world)).toBe('exhausted');
    expect(r.stored()?.state).toBe('exhausted');
    expect(r.notes).toHaveLength(1);
  });

  it('holds a merged revert whose merge commit cannot be read against the settled commit', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked', revertPr: 9 }));
    r.state.prs.set(9, pr({ state: 'MERGED', mergeCommit: REVERT_MERGE }));
    r.set({ settledHasRevert: 'unknown' });
    expect(await repairRevertTick(r.world)).toBe('held');
    expect(r.stored()?.state).toBe('reverting');
  });
});

describe('repairRevertTick — close-prs', () => {
  it('closes the open fix PR and the open revert PR the record names', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked', revertPr: 9 }));
    r.set({ reading: reading({ headSha: 'n'.repeat(40), head: 'green', settled: { sha: 'n'.repeat(40), state: 'green' } }) });
    r.state.prs.set(5, pr({ number: 5, head: 'bug/main-repair-gggggggggggg' }));
    r.state.prs.set(9, pr());
    expect(await repairRevertTick(r.world)).toBe('closed');
    expect(r.calls).toContain('pr-close:5');
    expect(r.calls).toContain('pr-close:9');
    expect(r.stored()?.state).toBe('done');
  });

  it('writes a ticket keyed by the reverted PR after a merged revert', async () => {
    const r = rig(record({ state: 'reverting', preRevertRerun: 'asked', revertPr: 9 }));
    r.set({ reading: reading({ headSha: 'n'.repeat(40), head: 'green', settled: { sha: 'n'.repeat(40), state: 'green' } }) });
    r.state.prs.set(9, pr({ state: 'MERGED' }));
    r.state.prs.set(41, pr({ number: 41, head: 'feature/the-thing', state: 'MERGED' }));
    expect(await repairRevertTick(r.world)).toBe('closed');
    expect(r.calls).toContain('ticket:pending');
    expect(r.calls).toContain('ticket:opened');
    expect(r.opened).toHaveLength(1);
    expect(r.opened[0]?.labels).toContain('ai-generated');
    expect(r.opened[0]?.body).toContain('#41');
    expect(r.calls).not.toContain('pr-close:9');
  });
});

describe('repairRevertTick — the anti-goal', () => {
  it('completes inside Main repair bound plus one re-run, one review and one merge round while the head moves every 12 minutes', async () => {
    const r = rig(record({ state: 'repairing' }), T0);
    const MIN = 60_000;
    const outcomes: string[] = [];
    let merged = false;
    let tick = 0;
    for (let minute = 0; minute <= 400 && r.stored()?.state !== 'done' && r.stored()?.state !== 'exhausted'; minute += 12) {
      tick += 1;
      const now = T0 + minute * MIN;
      // The head moves every tick. A bundle-bot push lands on every other tick, so the head is ahead of the settled SHA
      // on those and level with it on the rest; the settled SHA is a new red commit of the same episode each time.
      const settledSha = String(tick).padStart(40, 'e');
      const botAhead = tick % 2 === 1;
      r.state.prs.set(41, pr({ number: 41, head: 'feature/the-thing', state: 'MERGED' }));
      const revertPr = r.stored()?.revertPr;
      // The revert merges one tick before its merge commit settles: on that tick the settled SHA is still red.
      const settledGreen = merged;
      if (revertPr !== undefined && minute >= 60 + 20 + 30 + 20) {
        merged = true;
        r.state.prs.set(revertPr, pr({ number: revertPr, state: 'MERGED', mergeCommit: REVERT_MERGE }));
      }
      r.set({
        now,
        reading: settledGreen
          ? reading({ headSha: 'n'.repeat(40), head: 'green', settled: { sha: 'n'.repeat(40), state: 'green' }, askedAt: new Date(now).toISOString() })
          : reading({
              headSha: botAhead ? 'f'.repeat(40) : settledSha,
              settled: { sha: settledSha, state: 'red' },
              askedAt: new Date(now).toISOString(),
            }),
      });
      outcomes.push(await repairRevertTick(r.world));
    }
    expect(r.stored()?.state).toBe('done');
    expect(r.notes).toHaveLength(0);
    expect(r.calls.filter((c) => c === 'revert-commit')).toHaveLength(1);
    expect(r.calls.filter((c) => c === 'rerun:green')).toHaveLength(1);
    expect(outcomes).toContain('revert-opened');
    expect(outcomes).toContain('awaiting-revert');
    expect(tick * 12 * MIN).toBeLessThanOrEqual(HOUR + 20 * MIN + 30 * MIN + 30 * MIN + 12 * MIN * 3);
  });
});
