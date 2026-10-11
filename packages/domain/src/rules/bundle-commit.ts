import { BOARD_ARTIFACT_PATHS } from '../../../board/src/contract/bundles.generated.js';
import type { StagedPath } from '../ports/refs.js';

/**
 * Never refused, whatever the generated set says.
 *
 * Both are bundle INPUTS rather than outputs: two branches that each add a
 * bundle still conflict here, and reading that conflict is the correct
 * repair — `check-no-bundle-diff.sh`'s reason, applied before a commit
 * exists at all.
 */
const NEVER_REFUSED = new Set(['packages/board/src/contract/bundles.generated.ts', '.gitattributes']);

/** One staged generated path, and the repair command for it. */
export interface BundleCommitTouch {
  /** The staged path. */
  path: string;
  /**
   * `git restore` sourced from the merge base where it already held this
   * path, `git rm --cached` where it never did.
   */
  repair: string;
}

/**
 * What the commit gate read before deciding.
 */
export interface BundleCommitReadings {
  /** The index's staged paths, from `Refs.stagedPaths`. */
  staged: readonly StagedPath[];
  /**
   * The merge base's sha against the default branch's remote, or `null`
   * where none could be resolved — no remote, a scratch fixture, or
   * {@link Refs.mergeBase} failing outright.
   */
  mergeBase: string | null;
  /**
   * Whether the merge base held an object at each staged path that matches
   * the generated set, keyed by path. A path absent from this map is read
   * the same as `false`: the merge base never had it, so the repair is
   * `git rm --cached`.
   */
  existedAtMergeBase: Readonly<Record<string, boolean>>;
}

/**
 * The staged paths that touch the generated bundle set, each with its
 * repair command.
 *
 * **THE SET COMES FROM `BOARD_ARTIFACT_PATHS`, NEVER RE-DERIVED** —
 * `packages/board/src/contract/bundles.generated.ts`'s own committed,
 * generated array, the same one `check-bundle-attributes.sh` and
 * `check-no-bundle-diff.sh` already read.
 *
 * **A DELETE IS NEVER REFUSED.** Removing a generated path is never the
 * defect this gate exists for, which is why {@link StagedPath} carries no
 * `deleted` status to test against.
 *
 * @param readings - what the gate read before deciding.
 * @returns the touched paths, in the order they were staged; empty when
 *   `readings.mergeBase` is `null` or nothing staged matches the generated
 *   set.
 */
export const bundleCommitTouches = (readings: BundleCommitReadings): readonly BundleCommitTouch[] => {
  if (readings.mergeBase === null) return [];
  const generated = new Set(BOARD_ARTIFACT_PATHS);
  const touched: BundleCommitTouch[] = [];
  for (const entry of readings.staged) {
    if (!generated.has(entry.path) || NEVER_REFUSED.has(entry.path)) continue;
    const repair = readings.existedAtMergeBase[entry.path]
      ? `git restore --staged --worktree --source="${readings.mergeBase}" -- ${entry.path}`
      : `git rm --cached ${entry.path}`;
    touched.push({ path: entry.path, repair });
  }
  return touched;
};

/**
 * The refusal text for a commit staging a generated board bundle, or `null`
 * to allow.
 *
 * Refuses with no repair command when no merge base could be read — the
 * touched paths are still worth naming, but no source revision exists to
 * restore from. {@link onError} ('allow') is the gate's fail-open on its OWN
 * machinery (no git, no `Refs` answer); this is the separate case of the
 * machinery working and merely finding no merge base, which this rule still
 * treats as a refusal — a staged generated path is the defect regardless of
 * whether a repair command can be printed for it.
 *
 * @param readings - what the gate read before deciding.
 * @returns the refusal message naming every touched path, or `null` when
 *   nothing staged touches the generated set.
 */
export const bundleCommitRefusal = (readings: BundleCommitReadings): string | null => {
  const generated = new Set(BOARD_ARTIFACT_PATHS);
  const touchedPaths = readings.staged
    .map((entry) => entry.path)
    .filter((path) => generated.has(path) && !NEVER_REFUSED.has(path));
  if (touchedPaths.length === 0) return null;

  const lines = [
    'plot bundle-commit gate: this commit stages a generated board bundle. main builds its own bundles after every merge; a branch must not carry one.',
    '',
  ];

  const touches = bundleCommitTouches(readings);
  if (touches.length > 0) {
    lines.push('Restore each from the merge base, and remove one the merge base never had:');
    lines.push('');
    for (const touch of touches) lines.push(`    ${touch.repair}`);
    lines.push('');
  } else {
    lines.push('Unstage each generated path and restore it from the merge base against origin/main:');
    lines.push('');
  }

  lines.push('Staged generated paths:');
  for (const path of touchedPaths) lines.push(path);

  return lines.join('\n');
};
