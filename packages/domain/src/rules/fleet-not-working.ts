/** Why a registry entry is not working, as the Fleet card's not-working list words it. */
export type NotWorkingReason = 'merged' | 'finished' | 'stalled' | 'exited' | 'gone' | 'unread';

/**
 * Why a registry entry's agent is not working, from its registry state.
 *
 * `merged` where the agent's worker ended or finished and the branch it held merged; `stalled` keeps its
 * word, because its work is on the floor whatever the branch did. `failed`, `ended` and `none` read
 * `exited`; `elsewhere`, no worktree on this machine, reads `gone`; a state nobody could read reads `unread`.
 *
 * @param state - the entry's registry state.
 * @param merged - whether the host merged the branch the entry names.
 * @returns the reason, or `null` for a live state (`running`, `waiting`, or a state this rule does not know).
 */
export const notWorkingReason = (state: string, merged: boolean): NotWorkingReason | null => {
  switch (state) {
    case 'stalled': return 'stalled';
    case 'finished': return merged ? 'merged' : 'finished';
    case 'failed':
    case 'ended':
    case 'none': return merged ? 'merged' : 'exited';
    case 'elsewhere': return 'gone';
    case 'unknown': return 'unread';
    default: return null;
  }
};

/**
 * Whether a worktree that no manifest names counts as a fleet agent.
 *
 * A desk counts where a worker ran on it: its registry state is anything but `none`, the state for a
 * worktree with no `.plot-worker.pid` record. A `none` desk is a checkout that a person made, and the
 * registry fact leaves it out. A desk whose state nobody could read (`unknown`) counts, because the
 * registry cannot rule an agent out.
 *
 * @param state - the synthesized entry's registry state.
 * @returns `true` where the desk counts as an agent.
 */
export const isAgentDesk = (state: string): boolean => state !== 'none';

/** A plain sentence about the registry, and whether it is a warning. */
export interface RegistryFact {
  text: string;
  warn: boolean;
}

/** The registry counts that {@link registryFact} reads. */
export interface RegistryCounts {
  /** The manifests the registry read. */
  manifestCount: number;
  /** The entries synthesized from a desk with no manifest. */
  synthesizedCount: number;
  /** The synthesized desks where no worker ran ({@link isAgentDesk}). */
  checkoutCount: number;
  /** The synthesized desks whose state nobody could read (`unknown`); absent reads as 0. */
  unreadCount?: number;
}

/**
 * The one fact about the registry file that the Fleet card prints, shown only where it holds.
 *
 * Only a desk whose state was read counts. A checkout where no worker ran and a desk whose state is
 * `unknown` are out of both counts: the first is no agent, and for the second the registry has no
 * reading that says what it is ({@link workingCounts} names those).
 *
 * @param registry - the registry counts.
 * @returns `N of M agents have no registry file` where some agent with a read state has none, a warning
 *   where agents run and no agent has one, and `null` where every such agent has a registry file or none runs.
 */
export const registryFact = (registry: RegistryCounts): RegistryFact | null => {
  const unregistered = registry.synthesizedCount - registry.checkoutCount - (registry.unreadCount ?? 0);
  const total = registry.manifestCount + unregistered;
  if (unregistered <= 0) return null;
  if (registry.manifestCount === 0) return { text: `0 of ${total} agents have a registry file`, warn: true };
  const verb = unregistered === 1 ? 'has' : 'have';
  return { text: `${unregistered} of ${total} agents ${verb} no registry file`, warn: false };
};

/** The facts the Fleet card's WORKING header prints about the entries it does not show. */
export interface WorkingCounts<T> {
  /** The entries whose agent stopped; the header's `N not working` counts these and no other. */
  stopped: T[];
  /** The registry file fact ({@link registryFact}), or `null`. */
  registry: RegistryFact | null;
  /** `the board could not read the state of K worktrees`, as a warning, or `null` where every state was read. */
  unread: RegistryFact | null;
}

/**
 * Splits the not-working entries into stopped agents and desks whose state nobody could read.
 *
 * An `unread` entry is no failure and no proof of a missing agent, so it is in neither the stopped
 * count nor the registry fact, and the header names it in its own sentence.
 *
 * @param entries - the entries the header does not show, each with its {@link NotWorkingReason}.
 * @param registry - the registry counts, or `undefined` where the payload carries none.
 * @returns the stopped entries in input order, the registry fact, and the unread fact.
 */
export const workingCounts = <T extends { why: NotWorkingReason }>(
  entries: readonly T[],
  registry: RegistryCounts | undefined,
): WorkingCounts<T> => {
  const stopped = entries.filter((e) => e.why !== 'unread');
  const unreadCount = entries.length - stopped.length;
  const noun = unreadCount === 1 ? 'worktree' : 'worktrees';
  return {
    stopped,
    registry: registry === undefined ? null : registryFact(registry),
    unread: unreadCount === 0 ? null : { text: `the board could not read the state of ${unreadCount} ${noun}`, warn: true },
  };
};
