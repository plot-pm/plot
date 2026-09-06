import type { Issue } from '../../entities/issue.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import type {
  StatusOutcome,
  StatusWrite,
  Tracker,
  TrackerConfig,
} from '../../ports/tracker.js';
import { asText, runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { trackerReads } from './tracker-shell.js';

/** The scheme `plot-host.sh` knows this connector by. */
const SCHEME = 'jira';

/** How this connector's limit readings are tagged. */
const CONNECTOR = 'jira';

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
 * whatever a config key says. The write arm is the same script's one write op,
 * which shares this connector's credentials and therefore its budget.
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

  return {
    config: (): TrackerConfig => ({ scheme: SCHEME, baseUrl }),

    issueList: (limit): Promise<PortResult<readonly Issue[]>> => reads.issueList(limit),

    issueView: (id): Promise<PortResult<Issue>> => reads.issueView(id),

    statusWrite: async (write: StatusWrite): Promise<PortResult<StatusOutcome>> => {
      const key = keyIn(write.prUrl);
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

    limit: (): Promise<PortResult<readonly LimitReading[]>> => reads.limit(),

    lastRefusal: (): string | null => reads.lastRefusal(),
  };
};
