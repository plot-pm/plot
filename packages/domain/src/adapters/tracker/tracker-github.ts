import type { Issue } from '../../entities/issue.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type {
  ClosedIssues,
  IssueOpen,
  IssueOpenOutcome,
  IssueRead,
  StatusOutcome,
  StatusWrite,
  Tracker,
  TrackerConfig,
  TrackerSpender,
} from '../../ports/tracker.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { issueOpenOf, trackerReads } from './tracker-shell.js';

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
 * @param context - where the scripts and the repository are.
 * @returns a `Tracker` backed by this vendor's connector.
 */
export const trackerGithub = (context: ShellContext): Tracker => {
  const reads = trackerReads(
    { context, scheme: SCHEME, baseUrl: '', connector: CONNECTOR },
    { PLOT_TRACKER: SCHEME },
  );
  const config = scriptPath(context, 'plot-config.sh');
  const updateBoard = scriptPath(context, 'plot-update-board.sh');
  const inRepo = { cwd: context.repoRoot };

  return {
    config: (): TrackerConfig => ({ scheme: SCHEME, baseUrl: '' }),

    issueList: (limit): Promise<PortResult<readonly Issue[]>> => reads.issueList(limit),

    issueListClosed: (since, limit): Promise<PortResult<ClosedIssues>> => reads.issueListClosed(since, limit),
    issueListOpen: (limit): Promise<PortResult<IssueRead>> => reads.issueListOpen(limit),
    // NO PERSON-SCOPED MODE DISTINCT FROM THE OPEN READ. GitHub's open read is
    // never project-scoped the way Jira's becomes with `Ticket prefixes`, so
    // there is no second read to make here — the caller falls back to the
    // open rows it already has.
    issueListInbox: async (): Promise<PortResult<IssueRead>> =>
      unaskable('the GitHub tracker has no person-scoped read apart from its open read'),

    issueView: (id): Promise<PortResult<Issue>> => reads.issueView(id),

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

    limit: (): Promise<PortResult<readonly LimitReading[]>> => reads.limit(),

    lastRefusal: (): string | null => reads.lastRefusal(),

    spender: (): Promise<PortResult<TrackerSpender>> => reads.spender(),
  };
};
