import { describe, expect, it } from 'vitest';
import { agentRunFixture } from '../src/adapters/agent-run/agent-run-fixture.js';
import { agentLoop, type AgentLoopReadings } from '../src/workflows/agent-loop.js';
import type { AgentRunRequest, AgentRunResult } from '../src/ports/agent-run.js';

const BRANCH = 'infra/an-agent-run-is-a-port';
const WORKTREE = '/estate/.worktrees/infra-an-agent-run-is-a-port';
const SESSION = 'sess-an-agent-run-is-a-port';

const request = (over: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  worktree: WORKTREE,
  prompt: 'implement the brief',
  resumeId: '',
  role: 'worker',
  harness: 'claude',
  model: '',
  effort: '',
  maxTurns: 150,
  maxSpendUsd: 0,
  boundSeconds: 28800,
  capabilities: [],
  env: {},
  logFile: `${WORKTREE}/.plot-worker.log`,
  ...over,
});

const freeLoop: AgentLoopReadings = {
  assignedBranch: BRANCH,
  waitedSeconds: 0,
  boundSeconds: 28800,
  registration: 'unset',
  claim: 'held-by-agent',
  base: 'origin/main',
  running: null,
  exit: { answer: 'ran' },
  startRetries: 0,
  maxStartRetries: 2,
  markerWritten: false,
  markerText: '',
  handBack: null,
  checksResumeId: '',
  handBackSummary: '',
  resetRefusals: [],
  pushed: false,
  prOpen: false,
  checks: null,
  checksPassed: null,
  tip: 'pushed',
  correctionAttempts: 0,
  correctionBudget: 2,
  pr: null,
  correctionText: '',
  resumeId: '',
  passAt: '2026-10-05T10:00:00.000Z',
  worktree: WORKTREE,
  session: SESSION,
};

describe('agentRunFixture — a worker that hands back checks then pushed', () => {
  it('costs exactly two model runs, and the loop runs the checks and waits for CI with no model turn between them', async () => {
    const fixture = agentRunFixture({
      answers: [
        (): AgentRunResult => ({
          sessionId: 'sess-1',
          end: { answer: 'ran', handBack: { next: 'checks', summary: 'implemented the port' } },
          usageByModel: {},
          costUsd: null,
          turns: 12,
          limitReadings: [],
        }),
        (secondReq): AgentRunResult => ({
          sessionId: secondReq.resumeId,
          end: { answer: 'ran', handBack: { next: 'pushed', summary: 'pushed and opened the PR' } },
          usageByModel: {},
          costUsd: null,
          turns: 3,
          limitReadings: [],
        }),
      ],
    });

    // MODEL RUN 1: the worker's first turn hands back `checks`.
    const firstRun = await fixture.run(request());
    expect(firstRun.ok).toBe(true);
    if (!firstRun.ok) return;
    expect(firstRun.value.end.answer).toBe('ran');
    const firstHandBack = firstRun.value.end.answer === 'ran' ? firstRun.value.end.handBack : null;
    expect(firstHandBack?.next).toBe('checks');

    // The loop reads the hand-back and decides: run the local checks and
    // resume with the result — NO model turn happens here, only a write.
    const afterFirst = agentLoop({
      ...freeLoop,
      handBack: 'checks',
      checksResumeId: firstRun.value.sessionId,
      handBackSummary: firstHandBack?.summary ?? '',
    });
    expect(afterFirst.writes).toEqual([
      {
        kind: 'checks',
        branch: BRANCH,
        worktree: WORKTREE,
        resumeId: firstRun.value.sessionId,
        summary: 'implemented the port',
      },
    ]);
    expect(afterFirst.detail.exitCode).toBeNull();

    // MODEL RUN 2: the performer ran the checks (no model turn) and resumed
    // the same session; the agent's SECOND turn hands back `pushed`.
    const secondRun = await fixture.run(
      request({ resumeId: firstRun.value.sessionId, prompt: 'local checks passed: ok' }),
    );
    expect(secondRun.ok).toBe(true);
    if (!secondRun.ok) return;
    const secondHandBack = secondRun.value.end.answer === 'ran' ? secondRun.value.end.handBack : null;
    expect(secondHandBack?.next).toBe('pushed');

    // The loop reads `pushed` and jumps straight into the CI wait (rows
    // 12-18) — no model turn, and it waits rather than ending.
    const afterSecond = agentLoop({
      ...freeLoop,
      handBack: 'pushed',
      pushed: true,
      prOpen: true,
      checks: null,
    });
    expect(afterSecond.detail.note).toBe('waiting for checks');
    expect(afterSecond.writes).toEqual([]);

    // Exactly two model runs were asked of the fixture for this whole
    // sequence — the checks and the CI wait cost no model turn of their own.
    expect(fixture.requests).toHaveLength(2);
  });
});
