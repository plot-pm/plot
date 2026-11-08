/**
 * Which ref a lifecycle write is cut from and pushed at.
 *
 * Without a `State branch` key the answer is the default branch, and
 * {@link writeTarget} reports `none`. With a key, a write is cut from the
 * state ref's tip (from the default branch when the state ref does not exist
 * on the origin yet), merges `origin/<default>` into that cut, and pushes the
 * result at the state ref as a fast-forward.
 *
 * The key names a branch (`plot/state`, `refs/heads/plot/state`) or any other
 * full ref (`refs/plot/state`). Both are pushed and fetched by full ref name.
 *
 * @concept write-target
 */

/** A write that goes to the default branch: the key is absent, empty or blank. */
export interface NoWriteTarget {
  readonly kind: 'none';
}

/** A write that goes to the state ref. */
export interface StateWriteTarget {
  readonly kind: 'state';
  /** The full ref the write is pushed at, for example `refs/heads/plot/state`. */
  readonly pushRef: string;
  /** The local ref a fetch of {@link pushRef} stores the tip in. */
  readonly trackRef: string;
  /** The local ref holding the default branch's tip, merged into every cut. */
  readonly defaultRef: string;
  /** Whether {@link pushRef} is a branch, which a sync pull request can open from. */
  readonly isBranch: boolean;
}

/** A key value that is not a usable ref name. */
export interface InvalidWriteTarget {
  readonly kind: 'invalid';
  /** Why the value is refused, as one sentence. */
  readonly reason: string;
}

/** The three answers {@link writeTarget} gives. */
export type WriteTarget = NoWriteTarget | StateWriteTarget | InvalidWriteTarget;

const HEADS = 'refs/heads/';

/** Whether a name is a ref name git accepts, as far as this rule can tell without git. */
const isRefName = (name: string): boolean =>
  name !== '' &&
  !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name) &&
  !name.includes('..') &&
  !name.includes('@{') &&
  !name.includes('//') &&
  !name.startsWith('-') &&
  !name.startsWith('/') &&
  !name.endsWith('/') &&
  !name.endsWith('.') &&
  !name.endsWith('.lock') &&
  !name.split('/').some((part) => part.startsWith('.') || part === '');

/**
 * Resolves the `State branch` key into the ref a write targets.
 *
 * @param key - the value of `State branch` as configured; empty when the key is absent.
 * @param defaultBranch - the default branch's short name, for example `main`.
 * @returns `none` for an absent or blank key; `invalid` for a value that is
 *   not a ref name, names the default branch, or names a ref under
 *   `refs/remotes/` or `refs/tags/`; `state` otherwise.
 */
export const writeTarget = (key: string, defaultBranch: string): WriteTarget => {
  const value = key.trim();
  if (value === '') return { kind: 'none' };
  const full = value.startsWith('refs/') ? value : `${HEADS}${value}`;
  if (!isRefName(full)) return { kind: 'invalid', reason: `'${value}' is not a ref name` };
  if (full === `${HEADS}${defaultBranch}`) return { kind: 'invalid', reason: `'${value}' is the default branch` };
  if (full.startsWith('refs/remotes/') || full.startsWith('refs/tags/')) {
    return { kind: 'invalid', reason: `'${value}' is a ${full.startsWith('refs/tags/') ? 'tag' : 'remote-tracking'} ref` };
  }
  const isBranch = full.startsWith(HEADS);
  return {
    kind: 'state',
    pushRef: full,
    trackRef: isBranch ? `refs/remotes/origin/${full.slice(HEADS.length)}` : `refs/plot/state-tip/${full.slice('refs/'.length)}`,
    defaultRef: `refs/remotes/origin/${defaultBranch}`,
    isBranch,
  };
};

/**
 * The ref a booking worktree is cut from.
 *
 * @param target - the resolved state target.
 * @param stateExists - whether the origin holds the state ref.
 * @returns the state ref's local tip when it exists, else the default branch's.
 */
export const cutRef = (target: StateWriteTarget, stateExists: boolean): string =>
  stateExists ? target.trackRef : target.defaultRef;

/**
 * Whether a branch is the declared state ref, so a sweep keeps it.
 *
 * @param key - the value of `State branch` as configured.
 * @param defaultBranch - the default branch's short name.
 * @param branch - a branch name or full ref a delete path is about to remove.
 * @returns true when `branch` names the state ref.
 */
export const isStateRef = (key: string, defaultBranch: string, branch: string): boolean => {
  const target = writeTarget(key, defaultBranch);
  if (target.kind !== 'state') return false;
  const named = branch.startsWith('refs/') ? branch : `${HEADS}${branch}`;
  return named === target.pushRef;
};
