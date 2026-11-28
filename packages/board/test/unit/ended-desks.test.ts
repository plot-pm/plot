import { afterAll, describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentLoop, type AgentLoopReadings } from '@plot-pm/domain/workflows/agent-loop';
import { killedWorkerEnding } from '@plot-pm/domain/rules/ending-action';
import { readEnding } from '@plot-pm/domain/entities/ending';
import { deskFs } from '@plot-pm/domain/adapters/desk/desk-fs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { withEndedDesks } from '../../src/server/ended-desks.js';
import { anyFreeWaitEnded } from '../../src/server/fleet.js';
import { brokenAgentRows } from '../../src/app/lib/agent-rows/working-agents.js';
import { AgentEntrySchema, AgentRowSchema, type AgentRow } from '../../src/contract/schema.js';

/**
 * A desk whose free wait ran out with its slice merged, a clean tree and
 * nothing unpushed leaves Waiting on you. The deciding is
 * `endedDeskPlacement`'s; this file proves the board feeds it from the files
 * the real writers leave on the desk and from the slice's row, and that a
 * missing or unobserved reading keeps the entry where it was.
 */
const BRANCH = 'feature/x';
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** `agentLoop` ROW 2: a free loop whose wait reached `Worker bound`. */
const freeWaitRanOut = {
  assignedBranch: '', waitedSeconds: 28851, boundSeconds: 28800, registration: 'unset', claim: null,
  takeUpRefused: null, base: 'origin/main', continuation: null, running: null, exit: null, startRetries: 0,
  maxStartRetries: 2, markerWritten: false, markerText: '', handBack: null, checksResumeId: '',
  handBackSummary: '', localChecks: null, sliceRuns: 0, sliceMaxRuns: 12, backgroundDropResumed: false,
  sliceCostUsd: null, sliceMaxSpendUsd: null, resetRefusals: [], deskBranch: '', pushed: false, prOpen: false,
  commitBeyondClaim: 'unanswerable', checks: null, checksPassed: null, tip: 'pushed', correctionAttempts: 0,
  correctionBudget: 2, pr: null, correctionText: '', resumeId: '', passAt: '2026-10-15T08:40:00.000Z',
  worktree: '', session: 'free-04e1f562',
} satisfies AgentLoopReadings;

const noMainCheckout = { list: async () => ({ ok: false, why: 'failed' }) } as unknown as Trees;

/**
 * A desk directory holding what a free desk whose wait ran out holds: the
 * loop's own `free-wait-expired` ending as the desk adapter writes it, and
 * the loop's exit code as the wrapper records it. The supervisor composes no
 * ending for a desk that holds one.
 */
const freeWaitDesk = async (): Promise<string> => {
  const desk = mkdtempSync(join(tmpdir(), 'plot-ended-desks-'));
  roots.push(desk);
  const decision = agentLoop({ ...freeWaitRanOut, worktree: desk });
  const ending = decision.writes.find((w) => w.kind === 'loop-end');
  expect(ending).toMatchObject({ reason: 'free-wait-expired', actor: 'agent', branch: '', exitCode: 124 });
  const exit = String(decision.detail.exitCode);
  writeFileSync(join(desk, '.plot-worker.exit'), exit);
  expect((await deskFs(noMainCheckout).writeEnding(desk, ending as never)).ok).toBe(true);
  expect(killedWorkerEnding({ ending: readEnding(readFileSync(join(desk, '.plot-worker.ending.json'), 'utf8')), exit, loopAlive: false, branch: BRANCH })).toBeNull();
  return desk;
};

/**
 * A desk whose free wait ran out before `free-wait-expired` existed: exit 124
 * and the supervisor's `unreadable` ending. Desks on disk still hold this pair.
 */
const legacyFreeWaitDesk = async (): Promise<string> => {
  const desk = mkdtempSync(join(tmpdir(), 'plot-ended-desks-'));
  roots.push(desk);
  writeFileSync(join(desk, '.plot-worker.exit'), '124');
  const ending = killedWorkerEnding({ ending: { read: 'absent' }, exit: '124', loopAlive: false, branch: BRANCH });
  expect((await deskFs(noMainCheckout).writeEnding(desk, ending!)).ok).toBe(true);
  return desk;
};

/** A desk whose every write the harness refused, with no commit beyond the claim: `agentLoop` ROW 12a. */
const permissionDeniedDesk = async (): Promise<string> => {
  const desk = mkdtempSync(join(tmpdir(), 'plot-ended-desks-'));
  roots.push(desk);
  const decision = agentLoop({
    ...freeWaitRanOut,
    worktree: desk,
    assignedBranch: BRANCH,
    deskBranch: BRANCH,
    exit: { answer: 'ran' },
    pushed: true,
    prOpen: false,
    commitBeyondClaim: 'no',
    permissionDenials: 'yes',
  } as AgentLoopReadings);
  const ending = decision.writes.find((w) => w.kind === 'loop-end');
  expect(ending).toMatchObject({ reason: 'permission-denied' });
  expect((await deskFs(noMainCheckout).writeEnding(desk, ending as never)).ok).toBe(true);
  return desk;
};

/** A desk whose loop wrote no ending and whose supervisor has not recorded one yet. */
const unrecordedDesk = (): string => {
  const desk = mkdtempSync(join(tmpdir(), 'plot-ended-desks-'));
  roots.push(desk);
  writeFileSync(join(desk, '.plot-worker.exit'), '124');
  return desk;
};

/** The registry reads a desk with exit 124 and no PR fact as `failed`. */
const desk = (worktree: string, over: Record<string, unknown> = {}) =>
  AgentEntrySchema.parse({ session: 's1', branch: BRANCH, worktree, state: 'failed', ...over });

/** The slice's row, observed from this checkout: its `worker` is not `elsewhere`. */
const merged = (over: Record<string, unknown> = {}): AgentRow =>
  AgentRowSchema.parse({
    repo: 'r', branch: BRANCH, plan: 'p', wave: 'w', state: 'merged', group: 'done',
    ageMinutes: 1, note: '', worker: 'failed', ...over,
  });

const waiting = (agents: ReturnType<typeof desk>[]) => brokenAgentRows(agents, new Map()).map((r) => r.agent);

describe('a desk whose free wait ran out, in Waiting on you', () => {
  it('leaves for a merged slice, a clean tree and the records the real writers leave', async () => {
    const [agent] = withEndedDesks([desk(await freeWaitDesk())], [merged()]);
    expect(agent!.ended).toEqual({
      section: 'quiet',
      owesPerson: false,
      note: 'ended at the wait bound with no slice offered — reaped on the next pass',
    });
    expect(waiting([agent!])).toEqual([]);
  });

  it('leaves for a desk whose ending predates free-wait-expired: unreadable, supervisor, exit 124', async () => {
    const [agent] = withEndedDesks([desk(await legacyFreeWaitDesk())], [merged()]);
    expect(agent!.ended).toMatchObject({ section: 'quiet', owesPerson: false });
    expect(waiting([agent!])).toEqual([]);
  });

  it('stays when the tree is dirty', async () => {
    const [agent] = withEndedDesks([desk(await freeWaitDesk())], [merged({ localDirty: true })]);
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when commits are unpushed', async () => {
    const [agent] = withEndedDesks([desk(await freeWaitDesk())], [merged({ localAhead: 2 })]);
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when the desk holds a PLOT-BLOCKED question', async () => {
    const question = { firstLine: 'which?', askedAt: '2026-10-16T00:00:00Z' };
    const [agent] = withEndedDesks([desk(await freeWaitDesk())], [merged({ question })]);
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when the row was not observed from this checkout — a default is not a clean tree', async () => {
    const [agent] = withEndedDesks([desk(await freeWaitDesk())], [merged({ worker: 'elsewhere' })]);
    expect(agent!.ended?.owesPerson).toBe(true);
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when no ending record exists yet', () => {
    const [agent] = withEndedDesks([desk(unrecordedDesk())], [merged()]);
    expect(agent!.ended).toBeUndefined();
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('stays when no row joins the desk', async () => {
    const [agent] = withEndedDesks([desk(await freeWaitDesk())], []);
    expect(waiting([agent!])).toHaveLength(1);
  });

  it('attaches nothing to a live agent', async () => {
    const [agent] = withEndedDesks([desk(await freeWaitDesk(), { state: 'running' })], [merged()]);
    expect(agent!.ended).toBeUndefined();
  });

  it('words the note from the `boundSeconds` the caller passes, not a hardcoded value', async () => {
    const [withBound] = withEndedDesks([desk(await freeWaitDesk())], [merged()], 3600);
    expect(withBound!.ended?.note).toBe('ended after 1 h with no slice offered — reaped on the next pass');

    const [noBound] = withEndedDesks([desk(await freeWaitDesk())], [merged()], null);
    expect(noBound!.ended?.note).toBe('ended at the wait bound with no slice offered — reaped on the next pass');
  });

  it('lands the agent in Quiet, not Waiting on you, once released', async () => {
    const [agent] = withEndedDesks([desk(await freeWaitDesk())], [merged()]);
    expect(agent!.ended?.section).toBe('quiet');
  });
});

describe('a desk the harness refused every write to, in Waiting on you', () => {
  it('names the refusal, never the board\'s generic "worker finished" note', async () => {
    const [agent] = withEndedDesks([desk(await permissionDeniedDesk())], [merged()]);
    expect(agent!.ended).toEqual({
      section: 'waiting-on-you',
      owesPerson: true,
      note: 'agent was refused every write — check the worker command\'s permissions',
    });
    expect(waiting([agent!])).toHaveLength(1);
  });
});

describe('anyFreeWaitEnded — the gate on the `Worker bound` config read', () => {
  it('answers true only where an entry reads as the free wait running out', async () => {
    const d = await freeWaitDesk();
    expect(anyFreeWaitEnded([desk(d)])).toBe(true);
  });

  it('answers false for an unrecorded ending and for an agent with no worktree', () => {
    expect(anyFreeWaitEnded([desk(unrecordedDesk())])).toBe(false);
    expect(anyFreeWaitEnded([desk('')])).toBe(false);
  });

  it('answers false for an empty fleet, so no config read is ever paid for one', () => {
    expect(anyFreeWaitEnded([])).toBe(false);
  });
});
