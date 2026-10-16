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
  commitBeyondClaim: 'unanswerable', checks: null, checksPassed: null, tip: 'pushed', correctionAttempts: 0,
  correctionBudget: 2, pr: null, correctionText: '', resumeId: '', passAt: '2026-10-15T08:40:00.000Z',
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
  ] as const)('keeps a desk with %s with a person', async (_name, over) => {
    expect(endedDeskPlacement(clean(await freeWaitDesk(), over)).owesPerson).toBe(true);
  });

  it('keeps a desk with no ending record with a person — absent is not clean', async () => {
    const desk = await freeWaitDesk();
    expect(endedDeskPlacement(clean(desk, { ending: { read: 'absent' } }))).toEqual({ owesPerson: true, note: '' });
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
});
