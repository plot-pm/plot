const rootVersion = (raw: string | null): string => {
  if (raw === null || raw === '') return '';
  try {
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' ? version : '';
  } catch {
    return '';
  }
};

/**
 * The version a release branch would publish, read from its root `package.json` and its base's.
 *
 * Changesets writes the bumped root version into `package.json` on a `changeset-release/<base>`
 * branch. A release that bumps only a workspace package leaves the root version as the base
 * already carries it, and that version is already released, so it names no new release.
 *
 * @param branch - the release branch's root `package.json` text, or `null` where it was not read.
 * @param base - the base branch's root `package.json` text, or `null` where it was not read.
 * @returns the branch's root `version`, or `''` where either file is unread, unparseable or names
 *   no version, and where both name the same version.
 */
export const releaseBranchVersion = (branch: string | null, base: string | null): string => {
  const next = rootVersion(branch);
  const current = rootVersion(base);
  return next === '' || current === '' || next === current ? '' : next;
};
