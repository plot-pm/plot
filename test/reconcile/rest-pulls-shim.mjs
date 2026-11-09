// Turns the `gh pr list --json` rows a test stub holds into the REST `pulls`
// rows `plot-host.sh` now reads, so a stub keeps its table in the old shape.

export const restPull = (row) => ({
  number: row.number,
  title: row.title ?? '',
  state: row.mergedAt || row.state === 'CLOSED' || row.state === 'MERGED' ? 'closed' : 'open',
  draft: row.isDraft ?? false,
  html_url: row.url ?? '',
  updated_at: row.updatedAt ?? '2026-01-01T00:00:00Z',
  merged_at: row.mergedAt ?? null,
  merge_commit_sha: row.mergeCommit?.oid ?? null,
  user: { login: row.author?.login ?? '' },
  head: { ref: row.headRefName ?? '', sha: row.headRefOid ?? null },
  base: { ref: row.baseRefName ?? '' },
});

/** JS source for a node `gh` stub: answers `gh api …/pulls?…` from `rows` (an array, or a function of the head branch). */
export const restPullsStubSource = (rowsExpr) => `
if (argv[0] === 'api' && /\\/pulls\\?/.test(argv[1] || '')) {
  const rest = (row) => ({ number: row.number, title: row.title ?? '', state: row.mergedAt || row.state === 'CLOSED' || row.state === 'MERGED' ? 'closed' : 'open', draft: row.isDraft ?? false, html_url: row.url ?? '', updated_at: row.updatedAt ?? '2026-01-01T00:00:00Z', merged_at: row.mergedAt ?? null, merge_commit_sha: row.mergeCommit ? row.mergeCommit.oid : null, user: { login: (row.author && row.author.login) || '' }, head: { ref: row.headRefName ?? '', sha: row.headRefOid ?? null }, base: { ref: row.baseRefName ?? '' } });
  const m = /head=[^:&]*:([^&]*)/.exec(argv[1]);
  const head = m ? decodeURIComponent(m[1]) : '';
  const pg = Number((/[?&]page=(\\d+)/.exec(argv[1]) || [0, 1])[1]);
  const all = (${rowsExpr})(head).map(rest);
  process.stdout.write('HTTP/2 200\\r\\n\\r\\n' + JSON.stringify(all.slice((pg - 1) * 100, pg * 100)));
  process.exit(0);
}
`;
