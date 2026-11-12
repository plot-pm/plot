/** One Jira issue as the search endpoint returns it, for the fields the `issue-list` arm asks. */
export interface JiraIssue {
  readonly key?: unknown;
  readonly fields?: {
    readonly summary?: unknown;
    readonly created?: string | null;
    readonly updated?: string | null;
    readonly resolutiondate?: string | null;
    readonly status?: {
      readonly name?: string | null;
      readonly statusCategory?: { readonly name?: string | null } | null;
    } | null;
    readonly assignee?: { readonly emailAddress?: unknown; readonly accountId?: unknown } | null;
    readonly issuetype?: { readonly name?: unknown } | null;
    readonly fixVersions?: readonly { readonly name?: unknown }[] | null;
  } | null;
}

/** One Jira `issue-list` row, in the shape `plot-host.sh` prints it. */
export interface JiraIssueRow {
  number: unknown;
  title: unknown;
  url: string;
  createdAt: string;
  status: string;
  statusCategory: string;
  assignees: unknown[];
  releases: unknown[];
  type?: unknown;
  updatedAt?: string;
  closedAt?: string;
}

/** True where jq reads a value as true: anything but null, false and absent. */
const truthy = (value: unknown): boolean => value !== null && value !== undefined && value !== false;

/** jq's `a // b`: `b` where `a` is null, false or absent. */
const orElse = <T>(value: T | null | undefined, fallback: T): T => (truthy(value) ? (value as T) : fallback);

/**
 * Projects one Jira issue into an `issue-list` row.
 *
 * A declared duplicate of the jq program in `plot-host.sh`'s Jira `issue-list`
 * arm; `corpus/jira-issue-reads.corpus.test.ts` holds the two to one answer.
 * The assignee is the e-mail address where Jira returns one, else the account
 * id, and an unassigned issue has no assignee. `closedAt` is present on every
 * row of a closed read, and on a row of a changed read whose status category
 * is `Done`. `type` and `updatedAt` are present only where the issue carries
 * them.
 *
 * @param issue - the issue as the search endpoint returns it.
 * @param base - the Jira base URL, without a trailing slash.
 * @param state - the state the read asked for.
 * @returns the row.
 */
export const jiraIssueRow = (issue: JiraIssue, base: string, state: 'open' | 'closed' | 'inbox' | 'changed'): JiraIssueRow => {
  const fields = issue.fields ?? {};
  const category = orElse(fields.status?.statusCategory?.name, '');
  const assignee = fields.assignee;
  const who = assignee === null || assignee === undefined ? null : orElse(assignee.emailAddress, assignee.accountId ?? null);
  const row: JiraIssueRow = {
    number: issue.key,
    title: orElse(fields.summary, ''),
    url: `${base}/browse/${String(issue.key)}`,
    createdAt: orElse(fields.created, ''),
    status: orElse(fields.status?.name, ''),
    statusCategory: category,
    assignees: truthy(who) ? [who] : [],
    releases: (fields.fixVersions ?? []).map((one) => one.name ?? null),
  };
  if (truthy(fields.issuetype?.name)) row.type = fields.issuetype?.name;
  if (truthy(fields.updated)) row.updatedAt = fields.updated as string;
  if (state === 'closed' || (state === 'changed' && category === 'Done')) row.closedAt = orElse(fields.resolutiondate, '');
  return row;
};
