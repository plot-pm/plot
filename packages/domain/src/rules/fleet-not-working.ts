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

/**
 * The one fact about the registry the Fleet card prints, shown only where it holds.
 *
 * @param registry - the manifest count, the count of entries synthesized from a desk with no manifest,
 *   and how many of those synthesized desks are checkouts where no worker ran ({@link isAgentDesk}).
 * @returns `N of M agents have no registry file` where some agent has none, a warning where agents run
 *   and no agent has one, and `null` where every agent has a registry file or no agent runs.
 */
export const registryFact = (
  registry: { manifestCount: number; synthesizedCount: number; checkoutCount: number },
): RegistryFact | null => {
  const unregistered = registry.synthesizedCount - registry.checkoutCount;
  const total = registry.manifestCount + unregistered;
  if (unregistered === 0) return null;
  if (registry.manifestCount === 0) return { text: `0 of ${total} agents have a registry file`, warn: true };
  const verb = unregistered === 1 ? 'has' : 'have';
  return { text: `${unregistered} of ${total} agents ${verb} no registry file`, warn: false };
};
