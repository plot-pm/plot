import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { callerOf, type Caller } from '@plot-pm/domain';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { deleteLooseBranch, type LooseDeletePorts } from '../../shared/loose-delete-command.js';

/**
 * The master agent's `loose-delete` controller, with no board and no HTTP.
 *
 * ```
 * node plot-loose-delete-command.mjs <branch>
 * ```
 *
 * Deletes the remote ref of a branch no plan names and nobody works on. Refuses
 * the default, sprint and release branches, a branch a plan names, a branch a
 * desk or a registry manifest holds, a claimed branch, an open PR, a merged PR,
 * an unpushed local commit and a reading that does not answer. Pins the tip at `refs/plot/reaped/<branch>/<sha>` before it
 * deletes, and deletes nothing where the pin does not land.
 */

const USAGE = 'usage: plot-loose-delete-command.mjs <branch>';

type Printer = (s: string) => void;

/** The seams a test replaces. */
export interface LooseDeleteCommandDeps {
  /** The ports; the adapters where absent. */
  ports?: LooseDeletePorts;
  /** Who is asking; `PLOT_UNATTENDED=1` maps to `'unattended'` where absent. */
  caller?: Caller;
}

/**
 * Runs the loose-delete command.
 *
 * @param argv - the branch.
 * @param cwd - where the command runs; the repository is found from it.
 * @param scriptDir - where the helper scripts are.
 * @param deps - test seams.
 * @param write - where the report goes.
 * @param warn - where refusals go.
 * @returns the process exit code — 0 deleted, 1 refused or failed, 2 bad arguments.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  deps: LooseDeleteCommandDeps = {},
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const [branch, ...extra] = argv;
  if (branch === undefined || branch === '' || extra.length > 0) {
    warn(`plot-loose-delete-command: ${USAGE}\n`);
    return 2;
  }
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-loose-delete-command: not a git repository — run this from inside the checkout\n');
    return 1;
  }
  const outcome = await deleteLooseBranch({
    repoRoot: probe.value,
    scriptsDir: scriptDir,
    branch,
    caller: deps.caller ?? callerOf({ unattended: process.env.PLOT_UNATTENDED === '1' }),
    ports: deps.ports,
  });
  if (outcome.kind === 'refused') {
    warn(`plot-loose-delete-command: ${outcome.reason}: ${outcome.detail}\n`);
    return 1;
  }
  if (outcome.kind === 'failed') {
    warn(`plot-loose-delete-command: ${outcome.error}\n`);
    return 1;
  }
  write(`deleted ${branch} at ${outcome.tip}\nrestore: git branch ${branch} ${outcome.pin}\n`);
  return 0;
};

// Only when RUN, never when imported; see `dispatch-command.ts` for why.
declare const PLOT_EMBEDDED: boolean | undefined;
if (
  typeof PLOT_EMBEDDED === 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const scriptDir =
    process.env.PLOT_SCRIPTS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
