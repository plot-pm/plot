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
  contextWindow: 0,
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
  takeUpRefused: null,
  base: 'origin/main',
  running: null,
  exit: null,
  startRetries: 0,
  maxStartRetries: 2,
  markerWritten: false,
  markerText: '',
  handBack: null,
  checksResumeId: '',
  handBackSummary: '',
  localChecks: null,
  sliceRuns: 0,
  sliceMaxRuns: 12,
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

/** The simulated desk, CI and run history the driver below fills readings from. */
interface World {
  lastRun: AgentRunResult | null;
  localChecks: AgentLoopReadings['localChecks'];
  pushed: boolean;
  prOpen: boolean;
  checks: AgentLoopReadings['checks'];
  checksPassed: boolean | null;
  sliceRuns: number;
}

/** The readings one pass takes from the simulated world. */
const readingsFrom = (world: World): AgentLoopReadings => {
  const end = world.lastRun?.end ?? null;
  const handBack = end !== null && end.answer === 'ran' ? end.handBack : null;
  return {
    ...freeLoop,
    exit: world.lastRun === null ? null : { answer: 'ran' },
    handBack: handBack?.next ?? null,
    handBackSummary: handBack?.summary ?? '',
    checksResumeId: world.lastRun?.sessionId ?? '',
    localChecks: world.localChecks,
    pushed: world.pushed,
    prOpen: world.prOpen,
    checks: world.checks,
    checksPassed: world.checksPassed,
    sliceRuns: world.sliceRuns,
  };
};

describe('agentRunFixture — a worker that hands back checks then pushed', () => {
  it('costs exactly two model runs: agentLoop runs the checks and the CI wait with no model run between', async () => {
    const world: World = {
      lastRun: null,
      localChecks: null,
      pushed: false,
      prOpen: false,
      checks: null,
      checksPassed: null,
      sliceRuns: 0,
    };
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
        (resumed): AgentRunResult => {
          // The agent's second run pushes and opens its PR.
          world.pushed = true;
          world.prOpen = true;
          return {
            sessionId: resumed.resumeId,
            end: { answer: 'ran', handBack: { next: 'pushed', summary: 'pushed and opened the PR' } },
            usageByModel: {},
            costUsd: null,
            turns: 3,
            limitReadings: [],
          };
        },
      ],
    });

    const performed: string[] = [];
    let sealed = false;
    for (let pass = 0; pass < 10 && !sealed; pass += 1) {
      const decision = agentLoop(readingsFrom(world));
      for (const write of decision.writes) {
        performed.push(write.kind);
        if (write.kind === 'prompt-run' || write.kind === 'agent-resume') {
          const result = await fixture.run(
            write.kind === 'prompt-run'
              ? request()
              : request({ resumeId: write.resumeId, prompt: write.correction }),
          );
          if (!result.ok) throw new Error('the fixture run failed');
          world.lastRun = result.value;
          world.localChecks = null;
          world.sliceRuns += 1;
        } else if (write.kind === 'checks') {
          // The performer runs the local checks; no model run happens here.
          world.localChecks = { passed: true };
        } else if (write.kind === 'assignment-clear') {
          sealed = true;
        }
      }
      if (decision.detail.note === 'waiting for checks') {
        // The CI wait polls the build connector; no model run happens here.
        world.checks = 'settled';
        world.checksPassed = true;
      }
    }

    expect(sealed).toBe(true);
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[1]).toMatchObject({
      resumeId: 'sess-1',
      prompt: 'local checks passed: implemented the port',
    });
    expect(performed).toEqual([
      'desk-reset',
      'commit',
      'push',
      'prompt-run',
      'checks',
      'agent-resume',
      'declaration',
      'slice-spend',
      'assignment-clear',
    ]);
  });
});
