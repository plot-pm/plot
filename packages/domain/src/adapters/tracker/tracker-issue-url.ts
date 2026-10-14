/**
 * The URL of a follow-up issue, composed from facts the tracker and the PR state.
 *
 * A Jira key composes against the tracker's address as `<address>/browse/<key>`.
 * A numeric id on a GitHub-hosted tracker composes from the PR's own URL by
 * replacing `/pull/<n>` with `/issues/<id>`. Nothing else is guessed.
 *
 * @param scheme - the tracker's declared scheme, `''` where none is declared.
 * @param baseUrl - the tracker's address, `''` where none was given.
 * @param id - the issue id the tracker answered.
 * @param prUrl - the reviewed PR's URL.
 * @returns the issue URL, or null where none can be composed from these facts.
 */
export const reviewIssueUrl = (scheme: string, baseUrl: string, id: string, prUrl: string): string | null => {
  if (scheme === 'jira') return baseUrl === '' ? null : `${baseUrl.replace(/\/+$/, '')}/browse/${id}`;
  const github = /^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+/.exec(prUrl);
  if ((scheme === '' || scheme === 'github-issues') && github !== null && /^\d+$/.test(id)) {
    return `${github[1]}/issues/${id}`;
  }
  return null;
};
