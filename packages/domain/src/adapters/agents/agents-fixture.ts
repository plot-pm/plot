import { answered, failed, type PortResult } from '../../port-result.js';
import type { AgentDesk, AgentManifest, Agents } from '../../ports/agents.js';

/** The estate a fixture {@link Agents} answers from. */
export interface AgentsFixture {
  /** The agents this registry declares. `undefined` means the registry is unreadable. */
  declared?: readonly AgentManifest[];
  /** The desks this machine holds, keyed by absolute path. */
  desks?: Readonly<Record<string, AgentDesk>>;
}

/**
 * Fills a partial declaration out to a whole {@link AgentManifest}.
 *
 * Every absent field takes its empty value, which is the same contract
 * `agentsFs` applies to a manifest that omitted a key. A fixture that had to
 * state eleven fields to vary one would be rewritten as a helper by its first
 * caller.
 *
 * @param over - the fields the fixture states.
 * @returns a complete declaration.
 */
export const agentManifest = (over: Partial<AgentManifest> = {}): AgentManifest => ({
  session: '',
  resumeId: '',
  branch: '',
  slug: '',
  worktree: '',
  command: '',
  startedAt: '',
  pid: '',
  previousPid: '',
  relaunches: 0,
  attempts: 0,
  ...over,
});

/**
 * Fills a partial desk out to a whole {@link AgentDesk}.
 *
 * `exit: null` is the default because it is the reading of a desk whose worker
 * is still running or was killed outright — the common case, and never the same
 * fact as `''`.
 *
 * @param over - the fields the fixture states.
 * @returns a complete desk reading.
 */
export const agentDesk = (over: Partial<AgentDesk> = {}): AgentDesk => ({
  question: '',
  markers: [],
  pid: '',
  exit: null,
  ...over,
});

/**
 * Answers agent questions from fixtures instead of the filesystem.
 *
 * An adapter like any other: the same port, a different world behind it. It is
 * on the DRIVEN side deliberately — nothing above the ports is told a fixture
 * exists, so a caller written against {@link Agents} serves fixtures or a real
 * machine depending only on which adapter was constructed.
 *
 * It reads no environment. The estate is the argument, which is what lets a
 * caller hold exactly the estate it built regardless of what any global says.
 *
 * @param fixture - the agents and desks this estate holds.
 * @returns an `Agents` backed by that fixture.
 */
export const agentsFixture = (fixture: AgentsFixture = {}): Agents => {
  const desks = fixture.desks ?? {};

  return {
    declared: async (): Promise<PortResult<readonly AgentManifest[]>> =>
      // AN ABSENT LIST IS AN UNREADABLE REGISTRY, matching `agentsFs`: a
      // directory that is not there is `failed`, and an empty list is the
      // answer of a registry nothing has dispatched through.
      fixture.declared === undefined
        ? failed<readonly AgentManifest[]>()
        : answered(fixture.declared),

    declaration: async (session): Promise<PortResult<AgentManifest>> => {
      const found = (fixture.declared ?? []).find((agent) => agent.session === session);
      return found === undefined ? failed<AgentManifest>() : answered(found);
    },

    desk: async (worktree): Promise<PortResult<AgentDesk>> => {
      const found = desks[worktree];
      return found === undefined ? failed<AgentDesk>() : answered(found);
    },
  };
};
