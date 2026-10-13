import type { Issue } from '../../entities/issue.js';
import type { LimitReading } from '../../entities/limit.js';
import { unaskable, type PortResult } from '../../port-result.js';
import { issueSource, type IssueSource, type IssueSourceReading } from '../../rules/issue-source.js';
import type { ClosedIssues, IssueOpenOutcome, IssueRead, StatusOutcome, Tracker, TrackerConfig, TrackerSpender } from '../../ports/tracker.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { trackerReads } from './tracker-shell.js';
import { trackerGithub } from './tracker-github.js';
import { trackerJira } from './tracker-jira.js';
import { trackerNone } from './tracker-none.js';
import { TRACKER_LISTERS } from './tracker-listers.js';

// RE-EXPORTED FROM ITS OWN MODULE, so every importer of this file is unchanged
// while a shell entry can import the list without the connectors below it.
export { TRACKER_LISTERS } from './tracker-listers.js';

/** Where a repository declares which tracker it uses. */
const TRACKER_KEY = 'Tracker';

/**
 * Which connector a declared scheme names, and what it was told.
 *
 * A SCHEME WITH NO CONNECTOR GETS NONE, never a fall-through to whichever
 * connector happens to be nearest. A repository tracking with a vendor Plot has
 * no connector for would otherwise be shown the git host's issues under that
 * vendor's name — a list that is not wrong about any single row and is wrong
 * about all of them.
 *
 * The one scheme that means *there is no tracker* is the repository's own
 * plans, and it resolves the same way an unrecognised one does: to a connector
 * that reaches nothing and says so.
 *
 * Exported for test, because the mapping from a config word onto a connector is
 * where a silent fall-through would live.
 *
 * @param declared - the `Tracker` key's value, scheme first.
 * @param context - where the scripts and the repository are.
 * @returns the connector that scheme names.
 */
export const trackerFor = (declared: string, context: ShellContext): Tracker => {
  const [scheme = '', baseUrl = ''] = declared.trim().split(/\s+/);
  switch (scheme.toLowerCase()) {
    case 'jira':
      return trackerJira(context, baseUrl.replace(/\/+$/, ''));
    case 'github-issues':
      return trackerGithub(context);
    default:
      return trackerNone();
  }
};

/**
 * Reads which tracker a repository declared, and builds its connector.
 *
 * @param context - where the scripts and the repository are.
 * @returns the connector the repository's config names.
 */
export const trackerShell = async (context: ShellContext): Promise<Tracker> => {
  const said = await runProcess(
    'bash',
    [scriptPath(context, 'plot-config.sh'), 'get', TRACKER_KEY, ''],
    { cwd: context.repoRoot },
  );
  // A CONFIG THAT COULD NOT BE READ IS NOT A TRACKER. Guessing a connector here
  // would send a status write to a vendor nobody named; answering with the one
  // that reaches nothing keeps the failure visible at the call that needed it.
  return trackerFor(said.code === 0 ? said.stdout : '', context);
};

/**
 * Reads and writes issues through the git host's own connector, for a
 * repository that declared no tracker.
 *
 * NOT A CONNECTOR OF ITS OWN. It opens no account, holds no token and starts
 * no window — it is {@link trackerReads} driven with no `PLOT_TRACKER`
 * override, so `plot-host.sh issue-list`/`issue-view` fall through to their
 * own default (the git host's native issues), and `connector` is tagged with
 * the git host's OWN backend word so `limit()`'s existing filter
 * (`tracker-shell.ts`) reports that connector's bucket and nothing else. A
 * caller reading this `Tracker`'s `limit()` is reading the git host's budget,
 * not a second one nothing would charge against.
 *
 * THE WRITE ANSWERS `unaskable`, always, and says why. A status write has
 * nowhere native to land on a git host's own issue — there is no second surface
 * the way `trackerGithub`'s Projects write is one — and `unaskable` is the
 * honest answer the port-doc correction states: no tracker was declared, so no
 * status write was asked for either.
 *
 * @param gitHost - the repository's git host backend word, as `plot-host.sh
 *   backend` reports it.
 * @param context - where the scripts and the repository are.
 * @returns a `Tracker` backed by the git host's own connector.
 */
export const trackerGitHost = (gitHost: string, context: ShellContext): Tracker => {
  const reads = trackerReads({ context, scheme: '', baseUrl: '', connector: gitHost }, {});
  return {
    config: (): TrackerConfig => ({ scheme: '', baseUrl: '' }),
    issueList: (limit): Promise<PortResult<readonly Issue[]>> => reads.issueList(limit),
    issueListClosed: (since, limit): Promise<PortResult<ClosedIssues>> => reads.issueListClosed(since, limit),
    issueListOpen: (limit): Promise<PortResult<IssueRead>> => reads.issueListOpen(limit),
    issueView: (id): Promise<PortResult<Issue>> => reads.issueView(id),
    statusWrite: async (): Promise<PortResult<StatusOutcome>> =>
      unaskable("no Tracker declared; the git host's issues are read-only to Plot"),
    issueOpen: async (): Promise<PortResult<IssueOpenOutcome>> =>
      unaskable("no Tracker declared; the git host's issues are read-only to Plot"),
    limit: (): Promise<PortResult<readonly LimitReading[]>> => reads.limit(),
    lastRefusal: (): string | null => reads.lastRefusal(),
    spender: (): Promise<PortResult<TrackerSpender>> => reads.spender(),
  };
};

/**
 * The connector that answers one {@link issueSource} answer.
 *
 * `tracker` resolves through {@link trackerFor}, `git-host` through
 * {@link trackerGitHost}, and `nobody` to {@link trackerNone}.
 *
 * @param source - who answers the open-issue list.
 * @param declared - the `Tracker` config key's value, verbatim.
 * @param gitHost - the repository's git host backend word.
 * @param context - where the scripts and the repository are.
 * @returns the connector that answers this repository's issues.
 */
export const trackerOfSource = (
  source: IssueSource,
  declared: string,
  gitHost: string,
  context: ShellContext,
): Tracker => {
  switch (source.ask) {
    case 'tracker':
      return trackerFor(declared, context);
    case 'git-host':
      return trackerGitHost(gitHost, context);
    case 'nobody':
      return trackerNone(source.reason);
  }
};

/**
 * Who answers this repository's open-issue list, resolved to a `Tracker`.
 *
 * Reads {@link issueSource} over {@link TRACKER_LISTERS} and resolves the
 * answer through {@link trackerOfSource}.
 *
 * @param declared - the `Tracker` config key's value, verbatim.
 * @param gitHost - the repository's git host backend word.
 * @param context - where the scripts and the repository are.
 * @returns the connector that answers this repository's issues.
 */
export const trackerForIssues = (declared: string, gitHost: string, context: ShellContext): Tracker =>
  trackerOfSource(
    issueSource({ declared, gitHost, listers: TRACKER_LISTERS } satisfies IssueSourceReading),
    declared,
    gitHost,
    context,
  );
