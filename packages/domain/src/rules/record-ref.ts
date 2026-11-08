/**
 * Which ref holds a plan's lifecycle records.
 *
 * Without a `State branch` key, or while the state ref is not in the local
 * clone, the default branch holds them and {@link recordRef} reports `default`.
 * With both, the state ref holds them, and a listing is the union of the plan
 * paths at the state ref and at the default branch ({@link unionBlobs}): where
 * both hold a path the state ref's blob wins, and a path only the default
 * branch holds is read from there. A reader never merges and never pushes.
 *
 * The key resolves through {@link writeTarget}, so a reader and a writer agree
 * on the ref's name.
 *
 * @concept record-ref
 */
import { writeTarget } from './write-target.js';

/** The default branch holds the records. */
export interface DefaultRecordRef {
  readonly kind: 'default';
  /** The local ref holding the default branch's tip. */
  readonly ref: string;
}

/** The state ref holds the records, with the default branch's blobs beneath. */
export interface StateRecordRef {
  readonly kind: 'state';
  /** The local ref holding the state ref's tip. */
  readonly ref: string;
  /** The local ref holding the default branch's tip. */
  readonly defaultRef: string;
  /** The full ref on the origin, for example `refs/heads/plot/state`. */
  readonly pushRef: string;
  /** Whether the state ref is a branch, which a sync pull request can open from. */
  readonly isBranch: boolean;
}

/** The two answers {@link recordRef} gives. */
export type RecordRef = DefaultRecordRef | StateRecordRef;

/**
 * Answers which ref holds a plan's records.
 *
 * @param key - the value of `State branch` as configured; empty when absent.
 * @param defaultBranch - the default branch's short name, for example `main`.
 * @param stateExists - whether the state ref's local tip resolves to a commit.
 *   A missing ref and a failed read both pass `false`.
 * @returns `state` when the key names a usable ref and `stateExists`; `default`
 *   otherwise, including for a key that is not a ref name.
 */
export const recordRef = (key: string, defaultBranch: string, stateExists: boolean): RecordRef => {
  const target = writeTarget(key, defaultBranch);
  const defaultRef = `refs/remotes/origin/${defaultBranch}`;
  if (target.kind !== 'state' || !stateExists) return { kind: 'default', ref: defaultRef };
  return { kind: 'state', ref: target.trackRef, defaultRef: target.defaultRef, pushRef: target.pushRef, isBranch: target.isBranch };
};

/**
 * The local ref a state tip is read from, whether or not it exists yet.
 *
 * @param key - the value of `State branch` as configured.
 * @param defaultBranch - the default branch's short name.
 * @returns the tracking ref, or null where no usable key is declared.
 */
export const stateTrackRef = (key: string, defaultBranch: string): string | null => {
  const target = writeTarget(key, defaultBranch);
  return target.kind === 'state' ? target.trackRef : null;
};

/** A listing entry: the fields the union reads. */
interface Listed {
  readonly path: string;
}

/**
 * The union of two listings, the state ref's entry winning per path.
 *
 * @param state - the entries at the state ref.
 * @param defaults - the entries at the default branch.
 * @returns every state entry, then each default entry whose path the state ref lacks.
 */
export const unionBlobs = <T extends Listed>(state: readonly T[], defaults: readonly T[]): readonly T[] => {
  const held = new Set(state.map((blob) => blob.path));
  return [...state, ...defaults.filter((blob) => !held.has(blob.path))];
};

/** The board's lag line, as data. */
export interface LagLine {
  /** Commits the state ref holds that the default branch lacks. */
  readonly ahead: number;
  /** The open sync pull request's number, or null where none is open or none is known. */
  readonly syncPr: number | null;
  /** The sentence the plan page and the Delivery tab show. */
  readonly text: string;
}

/**
 * Builds the lag line.
 *
 * @param ahead - commits the state ref is ahead of the default branch.
 * @param syncPr - the open sync pull request's number; null for none.
 * @param defaultBranch - the default branch's short name.
 * @returns the line, with `none` for a missing sync pull request.
 */
export const lagLine = (ahead: number, syncPr: number | null, defaultBranch: string): LagLine => ({
  ahead,
  syncPr,
  text: `Records: ${ahead} ahead of ${defaultBranch} · sync PR: ${syncPr === null ? 'none' : `#${syncPr}`}`,
});

/** The default name `plot/state` carries when a key was declared and then removed. */
export const DEFAULT_STATE_BRANCH = 'plot/state';

/** A removed `State branch` key that strands records. */
export interface RemovedKeyFinding {
  readonly branch: string;
  readonly ahead: number;
  /** The fix, in order. */
  readonly fix: readonly string[];
  /** The sentence the reconcile section and the board row show. */
  readonly text: string;
}

/**
 * Names the records a removed key strands.
 *
 * @param key - the value of `State branch` as configured; empty when absent.
 * @param defaultBranch - the default branch's short name.
 * @param ahead - commits `origin/plot/state` holds that the default branch lacks;
 *   null where the branch does not exist or the count could not be read.
 * @returns a finding when no key is declared and the default-named branch is ahead; else null.
 */
export const removedKeyFinding = (key: string, defaultBranch: string, ahead: number | null): RemovedKeyFinding | null => {
  if (key.trim() !== '' || ahead === null || ahead <= 0) return null;
  const fix = [
    `merge the sync PR from ${DEFAULT_STATE_BRANCH} into ${defaultBranch}`,
    'then remove the State branch key (none is declared now)',
  ];
  return {
    branch: DEFAULT_STATE_BRANCH,
    ahead,
    fix,
    text: `${DEFAULT_STATE_BRANCH} is ${ahead} ahead of ${defaultBranch} and no State branch key is declared: its records are invisible to every reader. Fix, in order: ${fix.join('; ')}.`,
  };
};
