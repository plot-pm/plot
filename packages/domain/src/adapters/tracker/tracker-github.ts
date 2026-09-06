import type { Issue } from '../../entities/issue.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import type {
  StatusOutcome,
  StatusWrite,
  Tracker,
  TrackerConfig,
} from '../../ports/tracker.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { trackerReads } from './tracker-shell.js';

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
 * Reads and writes a tracker whose issues live with the git host's own vendor.
 *
 * A CONNECTOR, not an adapter with a branch. It holds this vendor's account,
 * this vendor's token and this vendor's window, and it never sees the Jira
 * connector's — which is the whole reason the two are separate files rather
 * than one `switch`.
 *
 * The read arm is `plot-host.sh`, told which scheme to answer as rather than
 * left to resolve one. The write arm is `plot-update-board.sh`, which speaks
 * the projects API this vendor keeps apart from its issues API — a second
 * surface, and the reason the write has a script of its own.
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

    issueView: (id): Promise<PortResult<Issue>> => reads.issueView(id),

    statusWrite: async (write: StatusWrite): Promise<PortResult<StatusOutcome>> => {
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

    limit: (): Promise<PortResult<readonly LimitReading[]>> => reads.limit(),

    lastRefusal: (): string | null => reads.lastRefusal(),
  };
};
