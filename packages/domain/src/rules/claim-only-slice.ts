import type { Host } from '../ports/host.js';
import type { Refs } from '../ports/refs.js';

/**
 * Whether a path is a blocked marker rather than work.
 *
 * `PLOT-BLOCKED*` at the repository root, the spelling the fleet scan looks for
 * and the worker writes.
 *
 * @param path - a path a commit changed, relative to the repository root
 * @returns true where the path is a marker
 */
export const isBlockedMarker = (path: string): boolean => path.startsWith('PLOT-BLOCKED');

/**
 * Whether a merged branch's PR carried anything but a marker or a claim.
 *
 * Reads the merge commit, not the branch: a squash-merged branch loses its ref,
 * and a three-dot diff is empty for every branch once it is merged. The host
 * names the commit and `Refs.commitFiles` lists the files it brought to the
 * default branch (`-m --first-parent`).
 *
 * Two exclusions and no others: a `PLOT-BLOCKED*` marker is a question to a
 * person, and the claim commit is empty so it contributes no path. A
 * documentation-only PR carried work.
 *
 * @param ports - the host that names the merge commit, and the refs that read it
 * @param branch - the merged branch to ask about
 * @returns `true` when the merge changed a path other than a marker, `false`
 *   when it changed none or only markers, and `'unknown'` when the host named
 *   no commit, named an empty one, or the commit's files could not be read
 */
export const carriedWorkOf = async (
  ports: { host: Host; refs: Refs },
  branch: string,
): Promise<boolean | 'unknown'> => {
  const sha = await ports.host.prMergeCommit(branch);
  if (!sha.ok) return 'unknown';
  // An empty answer contradicts the merge state the caller already holds.
  if (sha.value === '') return 'unknown';

  const files = await ports.refs.commitFiles(sha.value);
  if (!files.ok) return 'unknown';
  return files.value.some((path) => !isBlockedMarker(path));
};
