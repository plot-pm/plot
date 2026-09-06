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

  /**
   * Hands one queued slice to one free agent, by recording it on the agent.
   *
   * **THE DECISION WAS ALREADY MADE AND THIS ONLY WRITES IT DOWN.**
   * `matchQueue` is the assignment lock — one slice to one agent, never the
   * same slice twice — and it holds by the shape of its pass. This applies what
   * that pass decided, so it must not re-check, re-order or refuse on anything
   * the rule already weighed.
   *
   * **IT EXISTS BECAUSE A DECIDED HAND-OVER WAS NEVER PERFORMED.** Measured
   * 2026-09-06: a tick reported `handed=8` while all eight agents stayed
   * `branch: ""`, because the applier filtered to `worker-start` and skipped
   * every `agent-assign`. Six were then written by hand, twice in one day. A
   * count that names a write nobody makes is worse than no count.
   *
   * **IT REFUSES AN AGENT THAT ALREADY HOLDS A BRANCH.** Between the tick's
   * reading and this write an agent may have been given work by anything else
   * — another tick, a dispatch, an operator — and overwriting would strand that
   * slice with no record it was ever assigned. The refusal is a reading, not a
   * judgement: `branch !== ''` on the manifest as it stands now.
   *
   * @param session - the agent's session id, naming its manifest.
   * @param branch - the branch it is handed.
   * @param slug - that branch's plan slug, so the agent's scope travels with it.
   * @returns whether the assignment was recorded — `false` where the agent had
   *   since taken other work, never a throw.
   */
  assignSlice(session: string, branch: string, slug: string): Promise<PortResult<boolean>>;
}
