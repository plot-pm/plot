import type { StagedEntry, TreeEntry } from '../ports/refs.js';

/**
 * Never refused, whatever the generated set says.
 *
 * Both are bundle INPUTS rather than outputs: two branches that each add a
 * bundle still conflict here, and reading that conflict is the correct
 * repair — `check-no-bundle-diff.sh`'s reason, applied before a commit
 * exists at all.
 */
const NEVER_REFUSED = new Set(['packages/board/src/contract/bundles.generated.ts', '.gitattributes']);

/**
 * A `shipped*` declaration in `packages/board/build.mjs`:
 * `const shippedX = path.join(here, '../../<path>')`. The capture is the
 * quoted argument; only one that starts with `../../` names a repository path.
 */
const SHIPPED_DECLARATION = /shipped[A-Za-z]* = path\.join\([^)]*'\.\.\/\.\.\/([^']+)'\)/g;

/**
 * The generated bundle paths a `packages/board/build.mjs` declares, relative to
 * the repository root, sorted and without duplicates.
 *
 * Reads the same declarations as `check-no-bundle-diff.sh`,
 * `check-bundle-attributes.sh` and `scripts/main-bundles.sh`: every
 * `shipped<Name> = path.join(..., '../../<path>')`, with the `../../` prefix
 * removed. A declaration whose quoted argument does not start with `../../`
 * names no repository path and is left out.
 *
 * @param buildText - the text of `packages/board/build.mjs`.
 * @returns the declared paths; empty when the text declares none.
 */
export const shippedPathsOf = (buildText: string): readonly string[] => {
  const found = new Set<string>();
  for (const match of buildText.matchAll(SHIPPED_DECLARATION)) {
    // The pattern's one group always takes part in a match.
    found.add(match[1] as string);
  }
  return [...found].sort();
};

/** One staged generated path the commit would carry, and the repair command for it. */
export interface BundleCommitTouch {
  /** The staged path. */
  path: string;
  /**
   * `git restore` sourced from the sha of the merge base where it holds this
   * path, `git rm --cached` where it holds none.
   */
  repair: string;
}

/**
 * What the commit gate read before deciding.
 */
export interface BundleCommitReadings {
  /**
   * The generated bundle paths, from {@link shippedPathsOf} over the gated
   * repository's own `packages/board/build.mjs`. Empty allows every commit: a
   * repository with no `build.mjs` builds no bundle, so a bundle it tracks is
   * vendored rather than generated.
   */
  generated: readonly string[];
  /** The index's staged entries, from `Refs.stagedEntries`; a deletion is never refused. */
  staged: readonly Pick<StagedEntry, 'status' | 'path' | 'indexMode' | 'indexSha'>[];
  /**
   * The merge base the commit will have against `origin/main`: the sha of
   * `git merge-base origin/main HEAD <each MERGE_HEAD>`. `null` where it could
   * not be read — no remote, a scratch fixture, a `MERGE_HEAD` that does not
   * resolve, or the merge base failing.
   */
  mergeBase: string | null;
  /**
   * The (mode, sha) the merge base holds at each staged generated path, keyed
   * by path. A path mapped to `null` is one the merge base does not hold. `null`
   * for the whole reading means it could not be read, and a staged generated
   * path missing from the record reads the same.
   */
  atMergeBase: Readonly<Record<string, TreeEntry | null>> | null;
  /** The sha `origin/main` resolves to, or `null` where it does not resolve. */
  mainTip: string | null;
  /** Whether a merge is in progress, that is, whether `MERGE_HEAD` exists. */
  merging: boolean;
}

/**
 * The staged generated paths the commit would carry, in the order they were
 * staged, leaving out `bundles.generated.ts`, `.gitattributes` and a deletion.
 *
 * The gate asks the merge base about these paths only, so a commit that
 * stages no bundle reads no object.
 *
 * @param readings - the generated set and the staged entries.
 * @returns the staged generated paths; empty when none is staged.
 */
export const bundleCommitPaths = (
  readings: Pick<BundleCommitReadings, 'generated'> & { staged: readonly Pick<StagedEntry, 'status' | 'path'>[] },
): readonly string[] => {
  const generated = new Set(readings.generated);
  return readings.staged
    .filter((entry) => entry.status !== 'deleted')
    .map((entry) => entry.path)
    .filter((path) => generated.has(path) && !NEVER_REFUSED.has(path));
};

/**
 * Whether every reading the comparison needs was made: the merge base, the
 * merge base's entries, and one entry reading per staged generated path.
 */
const readable = (readings: BundleCommitReadings, paths: readonly string[]): boolean =>
  readings.mergeBase !== null &&
  readings.atMergeBase !== null &&
  paths.every((path) => readings.atMergeBase !== null && path in readings.atMergeBase);

/**
 * The staged generated paths whose (mode, sha) differs from the merge base's,
 * each with its repair command.
 *
 * **THE SET IS `readings.generated`**, read from the gated repository's own
 * `build.mjs`, so a branch that declares a new bundle is gated on it.
 *
 * **THE COMPARISON IS AGAINST THE MERGE BASE THE COMMIT WILL HAVE**, the base
 * `check-no-bundle-diff.sh` diffs against, so a path is allowed exactly when
 * that script reads it clean. A mode-only difference is a difference.
 *
 * **A DELETE IS NEVER REFUSED**, so {@link bundleCommitPaths} drops it.
 *
 * @param readings - what the gate read before deciding.
 * @returns the differing paths, in the order they were staged; empty when
 *   nothing differs, and also empty when a reading is missing, because no
 *   repair can be named from one.
 */
export const bundleCommitTouches = (readings: BundleCommitReadings): readonly BundleCommitTouch[] => {
  const paths = bundleCommitPaths(readings);
  if (!readable(readings, paths)) return [];
  const touched: BundleCommitTouch[] = [];
  for (const path of paths) {
    const base = readings.atMergeBase?.[path] ?? null;
    const entry = readings.staged.find((candidate) => candidate.path === path);
    if (base !== null && entry?.indexMode === base.mode && entry.indexSha === base.sha) continue;
    touched.push({
      path,
      repair:
        base === null
          ? `git rm --cached ${path}`
          : `git restore --staged --worktree --source="${readings.mergeBase}" -- ${path}`,
    });
  }
  return touched;
};

/**
 * The refusal text for a commit staging a generated board bundle that differs
 * from the merge base, or `null` to allow.
 *
 * Refuses with no repair command when a reading is missing: the staged paths
 * are still worth naming, but no source revision is known to restore from. A
 * missing reading is never read as "equal". {@link onError} ('allow') is the
 * gate's fail-open on its OWN machinery; this is the separate case of the
 * machinery working and a reading failing, which this rule refuses.
 *
 * @param readings - what the gate read before deciding.
 * @returns the refusal message naming every differing path, or `null` when no
 *   staged generated path differs from the merge base.
 */
export const bundleCommitRefusal = (readings: BundleCommitReadings): string | null => {
  const paths = bundleCommitPaths(readings);
  if (paths.length === 0) return null;
  const complete = readable(readings, paths);
  const touches = bundleCommitTouches(readings);
  if (complete && touches.length === 0) return null;

  const lines = [
    'plot bundle-commit gate: this commit stages a generated board bundle that differs from its merge base with origin/main. main builds its own bundles after every merge; a branch must not carry one.',
    '',
  ];

  if (!complete) {
    lines.push('The merge base could not be read, so no restore command is printed. Unstage each generated path and restore it from the merge base against origin/main:');
    lines.push('');
    lines.push('Staged generated paths:');
    for (const path of paths) lines.push(path);
    return lines.join('\n');
  }

  lines.push('Restore each from the merge base this commit will have, and remove one the merge base never had:');
  lines.push('');
  for (const touch of touches) lines.push(`    ${touch.repair}`);
  lines.push('');
  if (!readings.merging && readings.mainTip !== null && readings.mainTip !== readings.mergeBase) {
    lines.push('origin/main is ahead of that merge base. Run `git merge origin/main` first to take main\'s copies of the generated paths.');
    lines.push('');
  }
  lines.push('Staged generated paths:');
  for (const touch of touches) lines.push(touch.path);

  return lines.join('\n');
};
