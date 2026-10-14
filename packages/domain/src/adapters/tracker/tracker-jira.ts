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
import { asText, runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { issueOpenOf, trackerReads } from './tracker-shell.js';

/** The scheme `plot-host.sh` knows this connector by. */
const SCHEME = 'jira';

/** How this connector's limit readings are tagged. */
const CONNECTOR = 'jira';

/** The config key naming the projects; `issueOpen` opens in the first. */
const PROJECTS_KEY = 'Ticket prefixes';

/** The config key naming the issue type `issueOpen` opens. */
const ISSUE_TYPE_KEY = 'Tracker issue type';

/** The issue type where `Tracker issue type` is absent or empty. */
const DEFAULT_ISSUE_TYPE = 'Task';

/**
 * The key of the issue Jira's create answer names.
 *
 * @param stdout - Jira's JSON answer to `POST /rest/api/2/issue`.
 * @returns the key, or null where the answer is not JSON or names no key.
 */
export const jiraKeyOf = (stdout: string): string | null => {
  try {
    const key = (JSON.parse(stdout) as { key?: unknown } | null)?.key;
    return typeof key === 'string' && key !== '' ? key : null;
  } catch {
    return null;
  }
};

/**
 * The issue a pull request's status belongs to, read off its own address.
 *
 * A KEY IS IN THE BRANCH OR IT IS NOWHERE. This vendor's issues are named
 * `PROJ-123`, and a pull request that concerns one carries that key in its
 * branch name — which is the convention every ticket-tracking team here already
 * follows and the only place the link exists. Nothing composes a key it did not
 * read: an invented one transitions somebody else's ticket.
 *
 * Exported for test, because the extraction is this connector's whole mapping
 * from a Plot artifact onto a tracker one.
 *
 * @param prUrl - the pull request's address.
 * @returns the issue key, or null where the address names none.
 */
export const keyIn = (prUrl: string): string | null => {
  const found = /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(prUrl.toUpperCase());
  return found === null ? null : found[1];
};

/**
 * Reads and writes a tracker that is not the git host, under its own account.
 *
 * A CONNECTOR IN ITS OWN RIGHT, and the clearest case for why the port has two
 * rather than one implementation with a branch. This vendor authenticates with
 * an email and an API token of its own, meters its own window, and is reached
 * over a transport the git host's CLI does not speak. None of that is the git
 * host's, and a single implementation holding both would carry two accounts,
 * two budgets and two failure vocabularies in one place.
 *
 * The read arm is `plot-host.sh`, told which scheme to answer as rather than
 * left to resolve one — so this connector answers with this tracker's issues
 * whatever a config key says. The two writes are the same script's
 * `issue-status` and `issue-open` ops, which share this connector's
 * credentials and therefore its budget. This connector builds the
 * `issue-open` request: the first `Ticket prefixes` project, the
 * `Tracker issue type` word (default `Task`), the title, body and labels.
 *
 * @param context - where the scripts and the repository are.
 * @param baseUrl - the tracker's address; `''` lets the script read its config.
 * @returns a `Tracker` backed by this vendor's connector.
 */
export const trackerJira = (context: ShellContext, baseUrl = ''): Tracker => {
  // THE ADDRESS IS PASSED ONLY WHERE IT WAS GIVEN. An empty override would
  // otherwise blank the base URL the repository configured, and a blanked base
  // URL composes `/browse/PROJ-1` — a relative address that resolves nowhere.
  const env: Record<string, string> = { PLOT_TRACKER: SCHEME };
  if (baseUrl !== '') env.PLOT_JIRA_BASE_URL = baseUrl;

  const reads = trackerReads({ context, scheme: SCHEME, baseUrl, connector: CONNECTOR }, env);
  const host = scriptPath(context, 'plot-host.sh');
  const run = { cwd: context.repoRoot, env };
  const config = scriptPath(context, 'plot-config.sh');
  const inRepo = { cwd: context.repoRoot };

  return {
    config: (): TrackerConfig => ({ scheme: SCHEME, baseUrl }),

    issueList: (limit): Promise<PortResult<readonly Issue[]>> => reads.issueList(limit),

    issueListClosed: (since, limit): Promise<PortResult<ClosedIssues>> => reads.issueListClosed(since, limit),
    issueListOpen: (limit): Promise<PortResult<IssueRead>> => reads.issueListOpen(limit),

    // GATED HERE, NOT IN THE SHELL. `plot-host.sh`'s own `inbox` arm sends its
    // query unconditionally — the person-scoped read is what every Jira lanes
    // query used to be, so it never needed a precondition. The precondition
    // belongs to this read's PURPOSE, not its query: the inbox exists to keep a
    // reader's own tickets visible once `Ticket prefixes` turns the lanes
    // project-wide, so with no `Ticket prefixes` declared there is nothing for
    // it to add beyond the open read `waitingTickets` already has.
    issueListInbox: async (limit): Promise<PortResult<IssueRead>> => {
      const projects = await runProcess('bash', [config, 'get', PROJECTS_KEY, ''], inRepo);
      if (projects.code !== 0) {
        reads.refuse(projects.stderr.trim() || `plot-config.sh exited ${projects.code}`);
        return failed();
      }
      if (projects.stdout.trim() === '') {
        reads.refuse(null);
        return unaskable(`the Jira inbox read needs '${PROJECTS_KEY}' declared; with none, the open read is already person-scoped`);
      }
      return reads.issueListInbox(limit);
    },

    issueView: (id): Promise<PortResult<Issue>> => reads.issueView(id),

    statusWrite: async (write: StatusWrite): Promise<PortResult<StatusOutcome>> => {
      // THE ISSUE A CALLER NAMED WINS OVER ONE MINED FROM THE ADDRESS. It is
      // still read through `keyIn`, so a number from a `#NNN` line is no key
      // and writes nothing rather than a guessed one.
      const key = keyIn(write.issue ?? write.prUrl);
      // NO KEY IS `no-target`, NEVER A FAILURE. A pull request that names no
      // issue is the ordinary case for work nobody ticketed; the tracker was
      // reachable and there was simply nothing to write against.
      if (key === null) {
        reads.refuse(null);
        return answered<StatusOutcome>('no-target');
      }
      const said = await runProcess('bash', [host, 'issue-status', key, write.status], run);
      if (said.code === 4) {
        // The script says it cannot be asked, which for this op means the
        // repository's declared tracker is not this one. It is a configuration
        // fact rather than an incident, so it clears the refusal.
        reads.refuse(null);
        return { ok: false, why: 'unaskable' };
      }
      if (said.code !== 0) {
        reads.refuse(said.stderr.trim() || said.stdout.trim() || `plot-host.sh exited ${said.code}`);
        return failed();
      }
      reads.refuse(null);
      // THE WORD, NOT THE EXIT CODE. `no-target` and `written` are both clean
      // exits, and collapsing them would report a status the workflow refused
      // as one it recorded.
      return answered<StatusOutcome>(asText(said.stdout) === 'written' ? 'written' : 'no-target');
    },

    issueOpen: async (write: IssueOpen): Promise<PortResult<IssueOpenOutcome>> => {
      const projects = await runProcess('bash', [config, 'get', PROJECTS_KEY, ''], inRepo);
      const type = await runProcess('bash', [config, 'get', ISSUE_TYPE_KEY, DEFAULT_ISSUE_TYPE], inRepo);
      const unread = [projects, type].find((said) => said.code !== 0);
      if (unread !== undefined) {
        reads.refuse(unread.stderr.trim() || `plot-config.sh exited ${unread.code}`);
        return failed();
      }
      const project = projects.stdout.split(',').map((key) => key.trim()).find((key) => key !== '');
      if (project === undefined) {
        reads.refuse(null);
        return unaskable(`opening a Jira issue needs '${PROJECTS_KEY}' declared`);
      }
      const request = {
        fields: {
          project: { key: project },
          issuetype: { name: asText(type.stdout) || DEFAULT_ISSUE_TYPE },
          summary: write.title,
          description: write.body,
          labels: [...write.labels],
        },
      };
      const said = await runProcess('bash', [host, 'issue-open', JSON.stringify(request)], run);
      return issueOpenOf(said, jiraKeyOf, reads.refuse);
    },

    limit: (): Promise<PortResult<readonly LimitReading[]>> => reads.limit(),

    lastRefusal: (): string | null => reads.lastRefusal(),

    spender: (): Promise<PortResult<TrackerSpender>> => reads.spender(),
  };
};
