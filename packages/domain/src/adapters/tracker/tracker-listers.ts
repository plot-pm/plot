import type { IssueLister } from '../../rules/issue-source.js';

/**
 * The schemes a connector lists open issues from — the reading `issueSource`
 * takes. It names the same schemes {@link trackerFor} maps onto a connector:
 * Jira lists from any git host, and GitHub issues only where GitHub is the git
 * host, because `plot-host.sh` reads them through that host's CLI.
 *
 * ITS OWN MODULE, IMPORTING ONE TYPE. `tracker-resolve.ts` imports
 * `runProcess` and three connectors, and esbuild bundles what it is given: a
 * shell entry that needs this list alone would ship the connectors behind it.
 * `tracker-resolve.ts` re-exports it, so every existing importer is unchanged.
 */
export const TRACKER_LISTERS: readonly IssueLister[] = [
  { scheme: 'jira' },
  { scheme: 'github-issues', onlyOnHost: 'github' },
];
