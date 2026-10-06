import { answered, failed, type PortResult } from '../../port-result.js';
import type {
  AgentRun,
  AgentRunRequest,
  AgentRunResult,
} from '../../ports/agent-run.js';

/**
 * One scripted answer `agentRunFixture` gives for one call to `run`.
 *
 * A function rather than a plain value: a test asserting the hand-back
 * sequence `checks` then `pushed` needs the fixture's answer to change
 * between the two `run` calls it drives, and a fixture is the one place an
 * estate test may script that without a connector.
 */
export type AgentRunAnswer = (request: AgentRunRequest) => AgentRunResult;

/** What `agentRunFixture` is told to answer with. */
export interface AgentRunFixture {
  /**
   * The answers to give, in call order. The fixture gives the last one
   * again once the list is exhausted, so a test need not script every call
   * of a long-running loop.
   */
  answers?: readonly AgentRunAnswer[];
  /** Whether every call fails outright. */
  fails?: boolean;
}

/**
 * An `AgentRun` that answers from scripted values, reaching nothing.
 *
 * The connectors beside it spawn a harness, so a test asserting what the
 * loop decides from a run's result needs one that reaches no process at all.
 *
 * @param fixture - the answers to script, in call order.
 * @returns an `AgentRun` backed by those answers, and the calls it received.
 */
export const agentRunFixture = (
  fixture: AgentRunFixture = {},
): AgentRun & { readonly requests: AgentRunRequest[] } => {
  const answers = fixture.answers ?? [];
  const broken = fixture.fails === true;
  const requests: AgentRunRequest[] = [];

  return {
    requests,
    run: async (request: AgentRunRequest): Promise<PortResult<AgentRunResult>> => {
      requests.push(request);
      if (broken) return failed();

      const index = Math.min(requests.length - 1, answers.length - 1);
      const answer = index < 0 ? undefined : answers[index];
      if (answer === undefined) {
        return answered({
          sessionId: request.resumeId || 'fixture-session',
          end: { answer: 'ran', handBack: null },
          usageByModel: {},
          costUsd: null,
          turns: 0,
          limitReadings: [],
          account: null,
        });
      }
      return answered(answer(request));
    },
  };
};
