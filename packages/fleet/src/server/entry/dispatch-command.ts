import { readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detachedNode } from '@plot-pm/domain/adapters/detached/detached-node';
import { fleetStateFile } from '@plot-pm/domain/adapters/fleet-state/fleet-state-file';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import type { DetachedProcess, FleetReading, Scripts } from '@plot-pm/domain';
import { agentLogPath } from '../../shared/agent-log.js';
import { parseRunMarker, type BoardConfigReader } from '../../shared/board-run.js';
import { implementLogPath, implementStatePath } from '../../shared/implement-run.js';
import {
  SLUG_RE,
  briefBranchFromPulse,
  startDispatch,
} from '../../shared/dispatch-command.js';

/**
 * The master agent's `dispatch` controller, with no board and no HTTP.
 *
 * ```
 * node plot-dispatch-command.mjs <slug>
 * ```
 *
 * Holds what `POST /api/dispatch` decides: an `Implement command` must be
 * configured, a second dispatch of a slug whose implement still runs is
 * refused, the branch to brief comes from the bridged pulse, and
 * `plot-dispatch.sh` starts only after the implement exits 0, preceded by the
 * `dispatch` action receipt.
 *
 * The command returns once the implement has STARTED: it launches itself with
 * `--foreground` in a detached process, which holds the implement lock and
 * waits for the implement to end, and returns when the state file holds a
 * `running` marker naming that pid. A caller with a tool timeout therefore
 * never holds the implement open. Each launch writes its own launch log, named
 * by the launching process's pid, so a launch that loses the lock leaves the
 * winner's log whole.
 * {@link run} is the detached process's body: it waits for the implement and
 * its exit code reports whether the dispatch started.
 *
 * Not listed in the controller gate's `GATED` set: this command is the caller
 * that gate admits, and it writes the receipt itself.
 */

/** The usage line. */
const USAGE = 'usage: plot-dispatch-command.mjs <plan-slug>';

type Printer = (s: string) => void;

/** The seams a test replaces. */
export interface DispatchCommandDeps {
  /** The `Scripts` port that starts `plot-dispatch.sh`; the shell adapter where absent. */
  scripts?: Scripts;
  /** Reads `## Plot Config` keys; the shell reader where absent. */
  readCfg?: BoardConfigReader;
  /** The fleet reading the brief branch comes from; the bridge file where absent. */
  pulse?: (repoRoot: string) => FleetReading | null;
  /** Launches the `--foreground` process; a detached copy of this script where absent. */
  launch?: (slug: string, repoRoot: string, launchLog: string) => LaunchedChild;
  /** How long {@link runDetached} waits for the implement to start, in ms; 30 s where absent. */
  startWaitMs?: number;
  /** Names this launch's log apart from a concurrent launch's; this process's pid where absent. */
  launchId?: string;
}

/** The process {@link runDetached} waits on. */
export type LaunchedChild = DetachedProcess;

/**
 * Reads the pulse the fleet bridged to disk.
 *
 * @param repoRoot - the repository root.
 * @returns the bridged reading, or `null` where there is no trustworthy one.
 */
const bridgedPulse = (repoRoot: string): FleetReading | null => {
  const read = fleetStateFile({ repoRoot }).readSync();
  return read.ok && read.value !== null ? read.value.pulse : null;
};

/**
 * Runs the dispatch command.
 *
 * @param argv - the plan slug.
 * @param cwd - where the command runs; the repository is found from it.
 * @param scriptDir - where the helper scripts are.
 * @param deps - test seams.
 * @param write - where the report goes.
 * @param warn - where refusals go.
 * @returns the process exit code — 0 the dispatch started, 1 refused or failed, 2 bad arguments.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  deps: DispatchCommandDeps = {},
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const [slug, ...extra] = argv;
  if (slug === undefined || extra.length > 0 || !SLUG_RE.test(slug)) {
    warn(`plot-dispatch-command: ${USAGE}\n`);
    return 2;
  }
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn("plot-dispatch-command: not a git repository — run this from inside the checkout\n");
    return 1;
  }
  const repoRoot = probe.value;
  const readPulse = deps.pulse ?? bridgedPulse;
  const started = startDispatch({
    opts: { repoRoot, scriptsDir: scriptDir, scripts: deps.scripts },
    slug,
    readCfg: deps.readCfg,
    briefBranch: (s) => briefBranchFromPulse(readPulse(repoRoot), s),
  });
  if (started.kind === 'refused') {
    warn(`plot-dispatch-command: ${started.reason}: ${started.detail}\n`);
    return 1;
  }
  if (started.kind === 'failed') {
    warn(`plot-dispatch-command: ${started.error}\n`);
    return 1;
  }
  write(`implement started for ${slug}: ${started.implementLog}\n`);
  const end = await started.ended;
  if (!end.dispatched) {
    warn(
      end.error === undefined
        ? `plot-dispatch-command: the implement exited ${end.code} — no dispatch was started; read ${started.implementLog}\n`
        : `plot-dispatch-command: the implement succeeded and the dispatch could not start: ${end.error}\n`,
    );
    return 1;
  }
  write(`dispatch started for ${slug}: ${started.dispatchLog}\n`);
  return 0;
};

/** The flag that makes the command wait for the implement; the detached process runs with it. */
const FOREGROUND = '--foreground';

/** Launches this script again with {@link FOREGROUND}, detached, output to `launchLog`. */
const launchSelf = (slug: string, repoRoot: string, launchLog: string): LaunchedChild =>
  detachedNode().node(process.argv[1], [FOREGROUND, slug], repoRoot, launchLog);

/**
 * Runs the dispatch command and returns once the implement has started.
 *
 * @param argv - the plan slug.
 * @param cwd - where the command runs; the repository is found from it.
 * @param scriptDir - where the helper scripts are.
 * @param deps - test seams.
 * @param write - where the report goes.
 * @param warn - where refusals go.
 * @returns the process exit code — 0 the implement started, 1 refused, failed or not started in time, 2 bad arguments.
 */
export const runDetached = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  deps: DispatchCommandDeps = {},
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const [slug, ...extra] = argv;
  if (slug === undefined || extra.length > 0 || !SLUG_RE.test(slug)) {
    warn(`plot-dispatch-command: ${USAGE}\n`);
    return 2;
  }
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn("plot-dispatch-command: not a git repository — run this from inside the checkout\n");
    return 1;
  }
  const repoRoot = probe.value;
  const launchLog = agentLogPath(repoRoot, 'implement', `${slug}.launch.${deps.launchId ?? process.pid}`, 'log');
  const child = (deps.launch ?? launchSelf)(slug, repoRoot, launchLog);
  const statePath = implementStatePath(repoRoot, slug);
  const deadline = Date.now() + (deps.startWaitMs ?? 30_000);
  while (Date.now() < deadline) {
    let recorded = '';
    try {
      recorded = readFileSync(statePath, 'utf8').trim();
    } catch {
      /* not taken yet */
    }
    if (parseRunMarker(recorded)?.pid === child.pid) {
      write(`implement started for ${slug}: pid ${child.pid}, log ${implementLogPath(repoRoot, slug)}\n`);
      return 0;
    }
    const code = child.exitCode();
    if (code !== null) {
      let said = '';
      try {
        said = readFileSync(launchLog, 'utf8');
      } catch {
        /* the process wrote nothing */
      }
      warn(said === '' ? `plot-dispatch-command: the dispatch process exited ${code} before the implement started\n` : said);
      // Relayed above, and no later reader looks for a launch that started nothing.
      rmSync(launchLog, { force: true });
      return code === 0 ? 1 : code;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  warn(`plot-dispatch-command: the implement did not start within ${(deps.startWaitMs ?? 30_000) / 1000} s; read ${launchLog}\n`);
  return 1;
};

// Only when RUN, never when imported. `pathToFileURL` over `realpathSync`
// because `import.meta.url` is realpath-resolved and `process.argv[1]` is not.
declare const PLOT_EMBEDDED: boolean | undefined;
if (
  typeof PLOT_EMBEDDED === 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const scriptDir =
    process.env.PLOT_SCRIPTS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [first, ...rest] = process.argv.slice(2);
  process.exit(
    first === FOREGROUND
      ? await run(rest, process.cwd(), scriptDir)
      : await runDetached(process.argv.slice(2), process.cwd(), scriptDir),
  );
}
