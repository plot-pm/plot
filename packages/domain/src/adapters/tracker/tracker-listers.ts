import type { HostIssueLister, IssueLister } from '../../rules/issue-source.js';
import type { TicketSourceReading } from '../../rules/ownership.js';

/**
 * The schemes a connector lists open issues from — the reading `issueSource`
 * takes. It names the same schemes {@link trackerFor} maps onto a connector:
 * Jira lists from any git host, and GitHub issues only where GitHub is the git
 * host, because `plot-host.sh` reads them through that host's CLI.
 *
 * Each names how its issues write their assignees, which `ticketSourceOf`
 * reads: a Jira assignee is a Jira account, matched through a `People`
 * spelling `jira:<account>`; a GitHub issue's assignee is a GitHub login.
 *
 * ITS OWN MODULE, IMPORTING TYPES ONLY. `tracker-resolve.ts` imports
 * `runProcess` and three connectors, and esbuild bundles what it is given: a
 * shell entry that needs this list alone would ship the connectors behind it.
 * `tracker-resolve.ts` re-exports it, so every existing importer is unchanged.
 */
export const TRACKER_LISTERS: readonly IssueLister[] = [
  { scheme: 'jira', assignees: { service: 'jira', match: 'tracker-account', prefix: 'jira:' } },
  { scheme: 'github-issues', onlyOnHost: 'github', assignees: { service: 'github', match: 'host-login' } },
];

/**
 * The git hosts whose own issue list a repository with no declared tracker
 * reads, and how each writes its assignees: a GitHub or Bitbucket assignee is
 * a login on that host.
 */
export const HOST_ISSUE_LISTERS: readonly HostIssueLister[] = [
  { backend: 'github', assignees: { service: 'github', match: 'host-login' } },
  { backend: 'bitbucket', assignees: { service: 'bitbucket', match: 'host-login' } },
];

/** The reading `ticketSourceOf` takes: every lister the adapters declare. */
export const TICKET_SOURCES: TicketSourceReading = { listers: TRACKER_LISTERS, hosts: HOST_ISSUE_LISTERS };
