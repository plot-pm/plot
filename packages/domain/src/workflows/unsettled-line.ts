import type { Refs } from '../ports/refs.js';
import { ANCESTOR_ASKS_MAX } from '../rules/default-branch.js';
import type { UnsettledReading } from '../rules/settled-past.js';

/**
 * Reads the first-parent commits between a settled commit and the head, each
 * with the paths it changed.
 *
 * Costs one `firstParentCommits` call and one `commitFiles` call per commit,
 * at most {@link ANCESTOR_ASKS_MAX}; it asks no host. Rename detection is off,
 * so a file moved into a path set lists its source too.
 *
 * @param refs - the refs port.
 * @param settledSha - the settled commit.
 * @param headSha - the head the line ends at.
 * @returns `'unread'` where the line fails to read or holds more than
 *   {@link ANCESTOR_ASKS_MAX} commits; otherwise the line, with `'unknown'`
 *   files for a commit whose diff failed to read.
 */
export const readUnsettled = async (
  refs: Pick<Refs, 'firstParentCommits' | 'commitFiles'>,
  settledSha: string,
  headSha: string,
): Promise<UnsettledReading> => {
  if (settledSha === headSha) return { headSha, commits: [] };
  const line = await refs.firstParentCommits(`${settledSha}..${headSha}`);
  if (!line.ok || line.value.length > ANCESTOR_ASKS_MAX) return 'unread';
  const commits = await Promise.all(
    line.value.map(async (commit) => {
      const files = await refs.commitFiles(commit.sha, { noRenames: true });
      return { sha: commit.sha, files: files.ok ? files.value : ('unknown' as const) };
    }),
  );
  return { headSha, commits };
};
