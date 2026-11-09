import { writeTarget } from './write-target.js';

/**
 * What adoption says about the `State branch` key.
 *
 * Five states. Only `restricted`, `declared` and `invalid` speak.
 *
 * @concept state-branch-proposal
 */
export type StateBranchProposal =
  | StateBranchUnverified
  | StateBranchUnrestricted
  | StateBranchRestricted
  | StateBranchDeclared
  | StateBranchInvalid;

/** The host was not asked, or did not answer. Say so once; propose no key. */
export interface StateBranchUnverified {
  readonly state: 'unverified';
}

/** The host answered and holds no push restriction or merge check. Print nothing. */
export interface StateBranchUnrestricted {
  readonly state: 'unrestricted';
}

/** The default branch restricts pushes or requires a merge check; propose the key. */
export interface StateBranchRestricted {
  readonly state: 'restricted';
  /** The value to propose for `State branch`. */
  readonly proposed: string;
  /** The restriction words that decided it, as the host reported them. */
  readonly restrictions: readonly string[];
  /** Whether to offer the delete restriction on the state branch. Always true: the proposal is a branch. */
  readonly offerDelete: true;
}

/** The key is already set. The operator decided; the only output is a warning or an offer. */
export interface StateBranchDeclared {
  readonly state: 'declared';
  /** The configured value, trimmed. */
  readonly key: string;
  /** Whether the value names a branch, as `writeTarget` reads it. */
  readonly isBranch: boolean;
  /** What a non-branch value gives up, and the value to use instead; null for a branch. */
  readonly warning: StateBranchWarning | null;
  /** Whether to offer the delete restriction on the state branch. */
  readonly offerDelete: boolean;
}

/** The key is set to a value that is not a usable ref. */
export interface StateBranchInvalid {
  readonly state: 'invalid';
  readonly key: string;
  /** Why `writeTarget` refuses it. */
  readonly reason: string;
}

/** What a state ref outside `refs/heads/` gives up. */
export interface StateBranchWarning {
  /** The capabilities lost, one phrase each. */
  readonly givesUp: readonly string[];
  /** The value to recommend instead. */
  readonly recommended: string;
}

/** The value proposed for the key. */
export const PROPOSED_STATE_BRANCH = 'plot/state';

const RECOMMENDED_REF = `refs/heads/${PROPOSED_STATE_BRANCH}`;

const GIVES_UP: readonly string[] = [
  'the sync pull request',
  'the path gate',
  'the squash',
  'the delete-restriction offer',
];

/** Whether one restriction word stops a push or adds a merge check. */
const restrictsPushOrMerge = (word: string): boolean =>
  word === 'protected' || word === 'push' || word === 'restrict_merges' || word === 'enforce_merge_checks' || word.startsWith('require_');

/**
 * Decides what adoption says about the `State branch` key.
 *
 * A KEY ALREADY SET IS THE OPERATOR'S DECISION, so it is never proposed over
 * and the host is not consulted: the reading is ignored. A set key is judged
 * only for what it gives up (`isBranch` from {@link writeTarget}, never from
 * the string).
 *
 * ABSENT IS NOT FALSE. A reading of `null` is a host that was not asked and
 * reads `unverified`, never `unrestricted`. A restriction proposes the key; its
 * absence proposes nothing and claims nothing, because an unrestricted default
 * branch that deploys on every merge gains the same, and no host reading shows
 * a deploy.
 *
 * @param key - the `State branch` value as configured; `''` where absent.
 * @param defaultBranch - the default branch's short name.
 * @param restrictions - the host's restriction words for the default branch,
 *   `[]` where it holds none, `null` where the host was not asked.
 * @returns the proposal.
 */
export const proposeStateBranch = (
  key: string,
  defaultBranch: string,
  restrictions: readonly string[] | null,
): StateBranchProposal => {
  const value = key.trim();
  if (value !== '') {
    const target = writeTarget(value, defaultBranch);
    if (target.kind === 'invalid') return { state: 'invalid', key: value, reason: target.reason };
    if (target.kind === 'none') return { state: 'unverified' };
    return {
      state: 'declared',
      key: value,
      isBranch: target.isBranch,
      warning: target.isBranch ? null : { givesUp: GIVES_UP, recommended: RECOMMENDED_REF },
      offerDelete: target.isBranch,
    };
  }
  if (restrictions === null) return { state: 'unverified' };
  const found = restrictions.filter(restrictsPushOrMerge);
  if (found.length === 0) return { state: 'unrestricted' };
  return { state: 'restricted', proposed: PROPOSED_STATE_BRANCH, restrictions: found, offerDelete: true };
};
