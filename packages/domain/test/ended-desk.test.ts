import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { endedDeskPlacement, freeWaitEnded, readEnding, type EndedDeskReadings, type EndingReading } from '../src/index.js';
import { agentLoop, type AgentLoopReadings } from '../src/workflows/agent-loop.js';
import { killedWorkerEnding } from '../src/rules/ending-action.js';
import { deskFs } from '../src/adapters/desk/desk-fs.js';
import type { Trees } from '../src/ports/trees.js';

const BRANCH = 'feature/the-merged-slice';
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A free loop whose wait reached `Worker bound`: `agentLoop` ROW 2. */
const freeWaitRanOut: AgentLoopReadings = {
  assignedBranch: '', waitedSeconds: 28851, boundSeconds: 28800, registration: 'unset', claim: null,
  takeUpRefused: null, base: 'origin/main', continuation: null, running: null, exit: null, startRetries: 0,
  maxStartRetries: 2, markerWritten: false, markerText: '', handBack: null, checksResumeId: '',
  handBackSummary: '', localChecks: null, sliceRuns: 0, sliceMaxRuns: 12, backgroundDropResumed: false,
  sliceCostUsd: null, sliceMaxSpendUsd: null, resetRefusals: [], deskBranch: '', pushed: false, prOpen: false,
  commitBeyondClaim: 'unanswerable', permissionDenials: 'unanswerable', checks: null, checksPassed: null, tip: 'pushed', correctionAttempts: 0,
  correctionBudget: 2, pr: null, mergeable: null, mergeConflictAtEntry: false, prDraft: null, lastPushSha: '', correctionText: '', resumeId: '', passAt: '2026-10-15T08:40:00.000Z',
  worktree: '/estate/.worktrees/free-04e1f562', session: 'free-04e1f562',
};

/**
 * The desk files a free desk whose wait ran out holds, produced by the real
 * writers: `agentLoop` ROW 2 names the exit and writes no ending, the wrapper
 * records that exit code, and the supervisor's `killedWorkerEnding` is written
 * through the desk adapter.
 */
const freeWaitDesk = async (): Promise<{ ending: EndingReading; exit: string }> => {
  const decision = agentLoop(freeWaitRanOut);
  expect(decision.writes).toEqual([]);
  const exit = String(decision.detail.exitCode);
  const desk = mkdtempSync(join(tmpdir(), 'plot-ended-desk-'));
  roots.push(desk);
  writeFileSync(join(desk, '.plot-worker.exit'), exit);
  const ending = killedWorkerEnding({ ending: { read: 'absent' }, exit, loopAlive: false, branch: BRANCH });
  expect(ending).not.toBeNull();
  const noMainCheckout = { list: async () => ({ ok: false, why: 'failed' }) } as unknown as Trees;
  const written = await deskFs(noMainCheckout).writeEnding(desk, ending!);
  expect(written.ok).toBe(true);
  return {
    ending: readEnding(readFileSync(join(desk, '.plot-worker.ending.json'), 'utf8')),
    exit: readFileSync(join(desk, '.plot-worker.exit'), 'utf8'),
  };
};

const clean = (desk: { ending: EndingReading; exit: string }, over: Partial<EndedDeskReadings> = {}): EndedDeskReadings => ({
  ending: desk.ending,
  exit: desk.exit,
  merged: true,
  dirty: false,
  unlanded: false,
  blockedQuestion: false,
  boundSeconds: 28800,
  ...over,
});

describe('endedDeskPlacement', () => {
  it('releases a clean desk whose free wait ran out, from the records the real writers leave', async () => {
    const desk = await freeWaitDesk();
    expect(freeWaitEnded(desk.ending, desk.exit)).toBe(true);
    expect(endedDeskPlacement(clean(desk))).toEqual({
      section: 'quiet',
      owesPerson: false,
      note: 'ended after 8 h with no slice offered — reaped on the next pass',
    });
  });

  it('words the ending without hours where the bound is unknown', async () => {
    expect(endedDeskPlacement(clean(await freeWaitDesk(), { boundSeconds: null })).note).toBe(
      'ended at the wait bound with no slice offered — reaped on the next pass',
    );
  });

  it.each([
    ['unlanded commits', { unlanded: true }],
    ['a dirty tree', { dirty: true }],
    ['a PLOT-BLOCKED question', { blockedQuestion: true }],
    ['an unmerged slice', { merged: false }],
  ] as const)('names a desk with %s rather than leaving it a silent row — #1917', async (_name, over) => {
    expect(endedDeskPlacement(clean(await freeWaitDesk(), over))).toEqual({
      section: 'waiting-on-you',
      owesPerson: true,
      note: "ended a free wait with its last slice still checked out — the work left behind is the prior slice's, not this wait's",
    });
  });

  it('keeps a desk with no ending record with a person — absent is not clean', async () => {
    const desk = await freeWaitDesk();
    expect(endedDeskPlacement(clean(desk, { ending: { read: 'absent' } }))).toEqual({
      section: 'waiting-on-you',
      owesPerson: true,
      note: '',
    });
  });

  it('keeps a supervisor record for any exit other than 124 with a person', async () => {
    const desk = await freeWaitDesk();
    expect(endedDeskPlacement(clean(desk, { exit: '137' })).owesPerson).toBe(true);
    expect(endedDeskPlacement(clean(desk, { exit: null })).owesPerson).toBe(true);
  });

  it('keeps a loop-written ending with a person, `bound` included', () => {
    const boundEnd = agentLoop({
      ...freeWaitRanOut,
      assignedBranch: BRANCH,
      deskBranch: BRANCH,
      running: { verdict: 'silent', transcriptReadable: true },
      waitedSeconds: 28800,
    }).writes.find((w) => w.kind === 'loop-end');
    expect(boundEnd).toMatchObject({ reason: 'bound' });
    const bound = readEnding(JSON.stringify(boundEnd));
    expect(endedDeskPlacement({ ending: bound, exit: '124', merged: true, dirty: false, unlanded: false, blockedQuestion: false, boundSeconds: 28800 }).owesPerson).toBe(true);
  });

  it('names a permission-denied ending rather than falling back to the board\'s generic note', () => {
    const deniedEnd = agentLoop({
      ...freeWaitRanOut,
      assignedBranch: BRANCH,
      deskBranch: BRANCH,
      exit: { answer: 'ran' },
      pushed: true,
      prOpen: false,
      commitBeyondClaim: 'no',
      permissionDenials: 'yes',
    }).writes.find((w) => w.kind === 'loop-end');
    expect(deniedEnd).toMatchObject({ reason: 'permission-denied' });
    const denied = readEnding(JSON.stringify(deniedEnd));
    expect(endedDeskPlacement({ ending: denied, exit: null, merged: true, dirty: false, unlanded: false, blockedQuestion: false, boundSeconds: 28800 })).toEqual({
      section: 'waiting-on-you',
      owesPerson: true,
      note: 'agent was refused every write — check the worker command\'s permissions',
    });
  });

  it('keeps an unreadable record with a person', () => {
    expect(
      endedDeskPlacement({ ending: { read: 'unreadable', why: 'not JSON' }, exit: '124', merged: true, dirty: false, unlanded: false, blockedQuestion: false, boundSeconds: null }).owesPerson,
    ).toBe(true);
  });

  it('treats an unasked reading as not clean', async () => {
    const desk = await freeWaitDesk();
    for (const over of [{ merged: null }, { dirty: null }, { unlanded: null }, { blockedQuestion: null }]) {
      expect(endedDeskPlacement(clean(desk, over)).owesPerson).toBe(true);
    }
  });

  it('never disagrees with itself: `owesPerson` is exactly `section === \'waiting-on-you\'`', async () => {
    const desk = await freeWaitDesk();
    const readings: EndedDeskReadings[] = [
      clean(desk),
      clean(desk, { boundSeconds: null }),
      clean(desk, { unlanded: true }),
      clean(desk, { dirty: true }),
      clean(desk, { blockedQuestion: true }),
      clean(desk, { merged: false }),
      clean(desk, { ending: { read: 'absent' } }),
      clean(desk, { exit: '137' }),
      clean(desk, { exit: null }),
      { ending: { read: 'unreadable', why: 'not JSON' }, exit: '124', merged: true, dirty: false, unlanded: false, blockedQuestion: false, boundSeconds: null },
    ];
    for (const reading of readings) {
      const placement = endedDeskPlacement(reading);
      expect(placement.owesPerson).toBe(placement.section === 'waiting-on-you');
    }
  });
});
