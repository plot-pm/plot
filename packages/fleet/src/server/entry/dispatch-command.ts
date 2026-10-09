import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fleetStateFile } from '@plot-pm/domain/adapters/fleet-state/fleet-state-file';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import type { FleetReading, Scripts } from '@plot-pm/domain';
import type { BoardConfigReader } from '../../shared/board-run.js';
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
 * `dispatch` action receipt. The process waits for the implement to end, so its
 * exit code reports whether the dispatch started.
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
}

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
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
