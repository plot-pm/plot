import type { Issue } from '../../entities/issue.js';
import { ISSUE_PAGE_ROWS } from '../../entities/issue-index.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type {
  ClosedIssues,
  IssueCommentOutcome,
  IssueOpen,
  IssueOpenOutcome,
  IssueRead,
  StatusOutcome,
  StatusWrite,
  Tracker,
  TrackerConfig,
  TrackerSpender,
  VersionRead,
} from '../../ports/tracker.js';
import type { HostRefusal } from '../../ports/host.js';
import { githubIssueRow } from '../../rules/github-issue-row.js';
import type { GithubApi } from '../host/github-api.js';
import { githubIssueList, type GithubIssueList, type GithubIssueQuery } from '../host/github-issue-list.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { githubIssueClose, githubIssueLabel, githubPlanStateWrite } from './tracker-plan-state.js';
import { issueOf, issueOpenOf, newestCloseFirst, trackerReads } from './tracker-shell.js';

/** The scheme `plot-host.sh` knows this connector's read arm by. */
const SCHEME = 'github-issues';

/** How this connector's limit readings are tagged. */
const CONNECTOR = 'github';

/** Where the board this connector writes a status into is declared. */
const BOARD_KEY = 'Project board';

/**
 * What `Project board: owner/number` says, or null where it says nothing.
 *
 * Exported for test, because the shape of that key is this connector's own
 * contract with a repository's config and the one thing a status write can be
 * misconfigured by.
 *
 * @param value - the config key's value, as the script printed it.
 * @returns the owner and the project number, or null where neither is readable.
 */
export const boardOf = (value: string): { owner: string; number: string } | null => {
  const [owner, number] = value.trim().split('/');
  if (owner === undefined || number === undefined) return null;
  if (owner === '' || number === '') return null;
  return { owner, number };
};

/**
 * The number of the issue `gh issue create` printed the address of.
 *
 * @param stdout - the new issue's address, e.g. `https://github.com/o/r/issues/42`.
 * @returns the number, or null where the output ends in no issue address.
 */
export const githubIssueNumberOf = (stdout: string): string | null =>
  /\/issues\/(\d+)\s*$/.exec(stdout)?.[1] ?? null;

/**
 * Opens one GitHub issue through `plot-host.sh issue-open`, as the
 * `github-issues` scheme.
 *
 * `trackerGithub` and `trackerGitHost` on a `github` git host both open issues
 * this way: the request is `gh issue create` in the repository, with one
 * `--label` per label.
 *
 * @param context - where the scripts and the repository are.
 * @param refuse - records the refusal the calling connector's `lastRefusal` reports.
 * @returns the connector's `issueOpen`: `opened` with the issue number;
 *   `unaskable` on exit 4; `failed` otherwise, with the refusal recorded.
 */
export const githubIssueOpen =
  (context: ShellContext, refuse: (said: string | null) => void) =>
  async (write: IssueOpen): Promise<PortResult<IssueOpenOutcome>> => {
    const labels = write.labels.flatMap((label) => ['--label', label]);
    const said = await runProcess(
      'bash',
      [scriptPath(context, 'plot-host.sh'), 'issue-open', write.title, write.body, ...labels],
      { cwd: context.repoRoot, env: { PLOT_TRACKER: SCHEME } },
    );
    return issueOpenOf(said, githubIssueNumberOf, refuse);
  };

/**
 * Adds one comment to a GitHub issue through `plot-host.sh issue-comment`,
 * whose empty marker posts a new comment rather than editing one.
 *
 * @param context - where the scripts and the repository are.
 * @param refuse - records the refusal the calling connector's `lastRefusal` reports.
 * @returns the connector's `issueComment`: `commented`; `unaskable` on exit 4;
 *   `failed` otherwise, with the refusal recorded.
 */
export const githubIssueComment =
  (context: ShellContext, refuse: (said: string | null) => void, env: Record<string, string> = { PLOT_TRACKER: SCHEME }) =>
  async (id: string, body: string, marker = ''): Promise<PortResult<IssueCommentOutcome>> => {
    const said = await runProcess(
      'bash',
      [scriptPath(context, 'plot-host.sh'), 'issue-comment', id, marker, body],
      { cwd: context.repoRoot, env },
    );
    if (said.code === 4) {
      refuse(null);
      return unaskable(said.stderr.trim().replace(/^plot-host: /, '') || undefined);
    }
    if (said.code !== 0) {
      refuse(said.stderr.trim() || said.stdout.trim() || `plot-host.sh exited ${said.code}`);
      return failed();
    }
    refuse(null);
    return answered<IssueCommentOutcome>({ outcome: 'commented' });
  };

/** One issue listing per client, so a tracker built per pass asks the search-type introspection once per client. */
const listings = new WeakMap<GithubApi, GithubIssueList>();

/** The client's issue listing, built on first use. */
const issueListOf = (api: GithubApi): GithubIssueList => {
  const held = listings.get(api);
  if (held !== undefined) return held;
  const built = githubIssueList(api);
  listings.set(api, built);
  return built;
};

/** The reads {@link trackerGithub} and `trackerGitHost` send in-process where they are given a client. */
export interface InProcessReads {
  issueListOpen(limit: number): Promise<PortResult<IssueRead>>;
  issueListClosed(since: string, limit: number): Promise<PortResult<ClosedIssues>>;
  issueListChanged(since: string, limit: number): Promise<PortResult<IssueRead>>;
}

/**
 * The open, closed and changed issue reads over the in-process client.
 *
 * Each answers what `trackerReads` answers from `plot-host.sh issue-list`
 * for the same call: the rows through `githubIssueRow` and `issueOf`;
 * `complete` where the last page named no further page and the rows number
 * fewer than the limit; and `pages` as the larger of 1 and the listing pages
 * read, which is `ceil(rows / ISSUE_PAGE_ROWS)` for every answer `gh` gives.
 * A refusal answers `failed` and records GitHub's message for `lastRefusal`
 * and the whole refusal for `lastHostRefusal`. An origin with no GitHub
 * `owner/repo` answers `unaskable` and sends no request.
 *
 * @param api - the in-process GitHub client.
 * @param refuse - records the refusal both last-refusal reads report.
 * @returns the three reads.
 */
export const githubInProcessReads = (api: GithubApi, refuse: (refusal: HostRefusal | null) => void): InProcessReads => {
  const listing = issueListOf(api);
  const read = async (query: GithubIssueQuery, limit: number): Promise<PortResult<IssueRead>> => {
    if (api.origin.slug === null) {
      refuse(null);
      return unaskable('the origin remote names no GitHub owner/repo, so there is no GitHub repository to list issues of');
    }
    const answer = await listing.list(query, limit);
    if (!answer.ok) {
      refuse(answer.refusal);
      return failed();
    }
    refuse(null);
    const issues = answer.issues.map((one) => issueOf(githubIssueRow(one, query.state) as Parameters<typeof issueOf>[0]));
    return answered({
      issues,
      complete: answer.ended && issues.length < limit,
      pages: Math.max(1, answer.pages, Math.ceil(issues.length / ISSUE_PAGE_ROWS)),
    });
  };
  return {
    issueListOpen: (limit) => read({ state: 'open' }, limit),
    issueListClosed: async (since, limit) => {
      const closed = await read({ state: 'closed', since }, limit);
      return closed.ok ? answered({ ...closed.value, issues: newestCloseFirst(closed.value.issues) }) : closed;
    },
    issueListChanged: (since, limit) => read({ state: 'changed', since }, limit),
  };
};

/** A GitHub tracker, with the whole refusal of its last in-process read. */
export interface GithubTracker extends Tracker {
  /** The kind, wait and message of the last in-process read's refusal; null after an answer, and always null on the shell route. */
  lastHostRefusal(): HostRefusal | null;
}

/**
 * Reads and writes a tracker whose issues live with the git host's own vendor.
 *
 * A CONNECTOR, not an adapter with a branch. It holds this vendor's account,
 * this vendor's token and this vendor's window, and it never sees the Jira
 * connector's — which is the whole reason the two are separate files rather
 * than one `switch`.
 *
 * The read arm is `plot-host.sh`, told which scheme to answer as rather than
 * left to resolve one. There are two writes. The status write is
 * `plot-update-board.sh`, which speaks the projects API this vendor keeps apart
 * from its issues API — a second surface, and the reason that write has a
 * script of its own. The issue-open write is `plot-host.sh issue-open`, which
 * speaks the issues API through the same CLI as the reads.
 *
 * Given a client, the open, closed and changed reads go to GitHub's API in
 * this process instead of through `plot-host.sh`, with the requests `gh
 * issue list` sends; every other operation keeps the script.
 *
 * @param context - where the scripts and the repository are.
 * @param api - the in-process GitHub client; absent, every read runs the script.
 * @returns a `Tracker` backed by this vendor's connector.
 */
export const trackerGithub = (context: ShellContext, api?: GithubApi): GithubTracker => {
  const reads = trackerReads(
    { context, scheme: SCHEME, baseUrl: '', connector: CONNECTOR },
    { PLOT_TRACKER: SCHEME },
  );
  let hostRefusal: HostRefusal | null = null;
  const inProcess =
    api === undefined
      ? null
      : githubInProcessReads(api, (refusal) => {
          hostRefusal = refusal;
          reads.refuse(refusal?.said ?? null);
        });
  const config = scriptPath(context, 'plot-config.sh');
  const updateBoard = scriptPath(context, 'plot-update-board.sh');
  const inRepo = { cwd: context.repoRoot };

  return {
    config: (): TrackerConfig => ({ scheme: SCHEME, baseUrl: '' }),

    issueList: (limit): Promise<PortResult<readonly Issue[]>> => reads.issueList(limit),

    issueListClosed: (since, limit): Promise<PortResult<ClosedIssues>> =>
      inProcess === null ? reads.issueListClosed(since, limit) : inProcess.issueListClosed(since, limit),
    issueListOpen: (limit): Promise<PortResult<IssueRead>> =>
      inProcess === null ? reads.issueListOpen(limit) : inProcess.issueListOpen(limit),
    issueListWithTitle: (label, titleHas, limit): Promise<PortResult<IssueRead>> =>
      reads.issueListWithTitle(label, titleHas, limit),
    issueListChanged: (since, limit): Promise<PortResult<IssueRead>> =>
      inProcess === null ? reads.issueListChanged(since, limit) : inProcess.issueListChanged(since, limit),
    // NO PERSON-SCOPED MODE DISTINCT FROM THE OPEN READ. GitHub's open read is
    // never project-scoped the way Jira's becomes with `Ticket prefixes`, so
    // there is no second read to make here — the caller falls back to the
    // open rows it already has.
    issueListInbox: async (): Promise<PortResult<IssueRead>> =>
      unaskable('the GitHub tracker has no person-scoped read apart from its open read'),

    issueView: (id): Promise<PortResult<Issue>> => reads.issueView(id),

    // NO FIX-VERSION CONCEPT. GitHub Issues has no version or release this
    // tracker names; a milestone is a different entity this port does not model.
    versionRead: async (): Promise<PortResult<VersionRead>> =>
      unaskable('the GitHub tracker has no version or fixVersion concept'),

    statusWrite: async (write: StatusWrite): Promise<PortResult<StatusOutcome>> => {
      // NO PULL REQUEST IS NO SUBJECT. This arm writes a PR's Projects status
      // and has no issue equivalent, so an issue-only write reaches nothing —
      // and `plot-update-board.sh` is never handed an empty address.
      if (write.prUrl === '') {
        reads.refuse(
          `no pull request to write against${write.issue === undefined ? '' : ` for issue ${write.issue}`}: ` +
            'the GitHub tracker writes a pull request’s Projects status and has no issue status to write',
        );
        return answered<StatusOutcome>('no-target');
      }
      const board = await runProcess('bash', [config, 'get', BOARD_KEY, ''], inRepo);
      if (board.code !== 0) {
        reads.refuse(board.stderr.trim() || `plot-config.sh exited ${board.code}`);
        return failed();
      }
      const target = boardOf(board.stdout);
      // NO BOARD IS AN ANSWER, and a different one from no tracker. This
      // repository declared a tracker and reached it; it simply named nowhere
      // to put a status. Reporting that as a success would claim a write that
      // never happened, and as `unaskable` would claim a tracker nobody
      // configured.
      if (target === null) {
        reads.refuse(null);
        return answered<StatusOutcome>('no-target');
      }
      const run = await runProcess(
        'bash',
        [updateBoard, write.prUrl, write.status, target.owner, target.number],
        inRepo,
      );
      if (run.code !== 0) {
        reads.refuse(run.stderr.trim() || run.stdout.trim() || `plot-update-board.sh exited ${run.code}`);
        return failed();
      }
      // THE SCRIPT'S WARNINGS ARE READ, because it exits 0 on a graceful skip.
      // A missing token scope, a project it could not resolve and a status
      // option that does not exist all leave the status unwritten while the
      // process succeeds — so a connector reading only the exit code would
      // report every one of them as `written`.
      const warned = run.stderr.includes('Warning:');
      if (warned) {
        reads.refuse(run.stderr.trim());
        return answered<StatusOutcome>('no-target');
      }
      reads.refuse(null);
      return answered<StatusOutcome>('written');
    },

    issueOpen: githubIssueOpen(context, reads.refuse),

    issueComment: githubIssueComment(context, reads.refuse),
    issueLabel: githubIssueLabel(context, { PLOT_TRACKER: SCHEME }, reads.refuse),
    issueClose: githubIssueClose(context, { PLOT_TRACKER: SCHEME }, reads.refuse),
    issueLabelReach: (): PortResult<true> => answered(true),
    planStateWrite: githubPlanStateWrite(context, { PLOT_TRACKER: SCHEME }, reads.refuse),

    limit: (): Promise<PortResult<readonly LimitReading[]>> => reads.limit(),

    lastRefusal: (): string | null => reads.lastRefusal(),

    lastHostRefusal: (): HostRefusal | null => hostRefusal,

    spender: (): Promise<PortResult<TrackerSpender>> => reads.spender(),
  };
};
