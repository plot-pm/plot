/**
 * One GitHub issue as `gh issue list --json` exports it, for the fields the
 * `issue-list` arm of `plot-host.sh` asks.
 *
 * Every field but `number` and `title` is optional, because the arm asks a
 * different field list per state: `updatedAt` and `state` only for a changed
 * read, `labels` only for a closed read.
 */
export interface GhIssue {
  readonly number: unknown;
  readonly title: unknown;
  readonly url?: string | null;
  readonly createdAt?: string | null;
  readonly assignees?: readonly { readonly login?: unknown }[] | null;
  readonly issueType?: { readonly name?: unknown } | null;
  readonly milestone?: { readonly title?: unknown } | null;
  readonly updatedAt?: string | null;
  readonly state?: string | null;
  readonly closedAt?: string | null;
  readonly labels?: readonly { readonly name?: unknown }[] | null;
}

/** One `issue-list` row, in the shape `plot-host.sh` prints it. */
export interface GithubIssueRow {
  number: unknown;
  title: unknown;
  url: string;
  createdAt: string;
  status: string;
  statusCategory: string;
  assignees: unknown[];
  releases: unknown[];
  updatedAt?: string;
  type?: unknown;
  closedAt?: string;
  labels?: unknown[];
}

/** True where jq reads a value as true: anything but null, false and absent. */
const truthy = (value: unknown): boolean => value !== null && value !== undefined && value !== false;

/**
 * Projects one exported GitHub issue into an `issue-list` row.
 *
 * A declared duplicate of the jq program in `plot-host.sh`'s GitHub
 * `issue-list` arm; `corpus/github-issue-reads.corpus.test.ts` holds the two
 * to one answer. The status is the issue's own `state` where the read asked
 * it, and the asked state otherwise, in lower case. `statusCategory` is
 * `To Do` for `open` and `Done` for anything else. `closedAt` is present only
 * on a closed row, and `updatedAt`, `type` and `labels` only where the export
 * carries them.
 *
 * @param issue - the issue as `gh` exports it.
 * @param askedState - the state the read asked for: `open`, `closed` or `changed`.
 * @returns the row.
 */
export const githubIssueRow = (issue: GhIssue, askedState: string): GithubIssueRow => {
  const actual = String(issue.state ?? askedState).toLowerCase();
  const row: GithubIssueRow = {
    number: issue.number,
    title: issue.title,
    url: issue.url ?? '',
    createdAt: issue.createdAt ?? '',
    status: actual,
    statusCategory: actual === 'open' ? 'To Do' : 'Done',
    assignees: (issue.assignees ?? []).map((one) => one.login ?? null),
    releases: truthy(issue.milestone?.title) ? [issue.milestone?.title] : [],
  };
  if (truthy(issue.updatedAt)) row.updatedAt = issue.updatedAt as string;
  if (truthy(issue.issueType?.name)) row.type = issue.issueType?.name;
  if (actual === 'closed') row.closedAt = issue.closedAt ?? '';
  if (issue.labels !== null && issue.labels !== undefined) row.labels = issue.labels.map((one) => one.name ?? null);
  return row;
};
