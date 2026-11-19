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

/** A plain sentence about the registry, and whether it is a warning. */
export interface RegistryFact {
  text: string;
  warn: boolean;
}

/**
 * The one fact about the registry the Fleet card prints, shown only where it holds.
 *
 * @param registry - the manifest count and the count of entries synthesized from a desk with no manifest.
 * @returns `N of M agents have no registry file` where some entry has none, a warning where no entry has
 *   one, and `null` where every agent has a registry file.
 */
export const registryFact = (registry: { manifestCount: number; synthesizedCount: number }): RegistryFact | null => {
  const total = registry.manifestCount + registry.synthesizedCount;
  if (registry.manifestCount === 0) {
    return { text: total === 0 ? 'the registry holds no agent file' : `0 of ${total} agents have a registry file`, warn: true };
  }
  if (registry.synthesizedCount === 0) return null;
  const verb = registry.synthesizedCount === 1 ? 'has' : 'have';
  return { text: `${registry.synthesizedCount} of ${total} agents ${verb} no registry file`, warn: false };
};
