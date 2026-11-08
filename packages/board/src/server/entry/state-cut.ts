import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cutBooking, pushTargetOf, Refused, stateTargetOf, type LadderContext, type Printer } from './ladder.js';

/**
 * Cuts a booking worktree for a lifecycle write made outside the ladder, and
 * names the ref the write is pushed at.
 *
 * ```
 * plot-state-cut.mjs <worktree> <branch> <default-branch>
 * # exit 0 — the worktree exists on <branch>; the ref to push at is on stdout
 * # exit 1 — the cut was refused or could not be prepared; the reason is on stderr
 * # exit 2 — arguments missing
 * ```
 *
 * The cut is {@link cutBooking}'s: from `origin/<default>` where no
 * `State branch` key is declared, else from the state ref with the default
 * branch merged in. It fetches `origin/<default>` first, so a caller needs no
 * fetch of its own. It runs once per operator command, which the cost rule
 * permits (`docs/shell-and-domain.md`).
 */

const USAGE = 'usage: plot-state-cut.mjs <worktree> <branch> <default-branch>';

/**
 * Cuts the worktree and prints the push target.
 *
 * @param argv - the worktree path, the booking branch and the default branch.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where the push target goes.
 * @param warn - where refusals go.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const [tmpwt, bookbr, main] = argv;
  if (!tmpwt || !bookbr || !main) {
    warn(`${USAGE}\n`);
    return 2;
  }
  const context = { repoRoot: cwd, scriptDir };
  const ctx: LadderContext = { repoRoot: cwd, scripts: scriptsShell(context), trees: treesGit(context) };
  try {
    await ctx.trees.fetch(cwd, main);
    const cut = await cutBooking(ctx, tmpwt, bookbr, main, 'add');
    if (!cut.ok) {
      warn(`plot-state-cut: could not prepare a booking worktree at ${tmpwt} from ${main}\n`);
      return 1;
    }
    write(`${pushTargetOf(await stateTargetOf(ctx, main), main)}\n`);
    return 0;
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-state-cut: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
