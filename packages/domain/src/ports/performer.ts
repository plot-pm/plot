import type { PortResult } from '../port-result.js';

/**
 * Starts agents — the one write that reaches the process table.
 *
 * **A PORT RATHER THAN A CALL, BECAUSE THE DOMAIN MUST NOT NAME A HARNESS.**
 * `AgentStartWrite` has always carried a branch and a worktree and deliberately
 * no command: Plot hardcodes no agent tooling, so the decision says *start an
 * agent here* and an adapter answers *this is how this project starts one*. The
 * shape is the layering rule's — the domain owns this interface, an adapter
 * implements it, and only the adapter may reach the world.
 *
 * **IT IS NOT THE `Processes` PORT.** That one READS the process table and can
 * destroy nothing; this one starts detached processes that outlive the caller.
 * One port answering both would give every reader of a pid the ability to spawn,
 * and the read side is reached from the board's five-second poll.
 */
export interface Performer {
  /**
   * Starts one agent with no slice assigned — free, registered, waiting.
   *
   * **THE DESK IS THE CALLER'S AND THE MANIFEST IS THE ADAPTER'S.** The decision
   * names where the agent sits, because that is a fact about the estate; how the
   * agent is registered, what session id it carries and which monitors are
   * attached are the adapter's, because they are facts about this project's
   * tooling.
   *
   * @param worktree - the desk the agent runs in, absolute.
   * @returns how many agents were started — 0 where the machine or the project
   *   refused, never a throw. `unaskable` where no agent tooling is configured,
   *   which is a first-class answer and not a failure.
   */
  startFreeAgent(worktree: string): Promise<PortResult<number>>;
}
