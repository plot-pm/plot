import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cutBooking, pushTargetOf, pushUnderLock, Refused, stateTargetOf, type LadderContext, type Printer } from './ladder.js';

/**
 * Cuts a booking worktree for a lifecycle write made outside the ladder, and
 * names the ref the write is pushed at.
 *
 * ```
 * plot-state-cut.mjs <worktree> <branch> <default-branch>
 * # exit 0 — the worktree exists on <branch>; the ref to push at is on stdout
 * # exit 1 — the cut was refused or could not be prepared; the reason is on stderr
 * # exit 2 — arguments missing
 *
 * plot-state-cut.mjs --land [<default-branch>]
 * # exit 0 — HEAD, with the target's tip merged in, landed on the state ref or the default branch
 * # exit 1 — the merge conflicted, the push was rejected, or, with no `State branch` key,
 * #          HEAD is not on the default branch (a detached HEAD included); the reason is on stderr
 * # exit 3, 4 — the Writer app refused before pushing; the reason is on stderr
 * # exit 6 — another default-branch writer held the push lock for the whole wait; nothing was pushed
 * ```
 *
 * `--land` serves a skill that committed in a checkout of the default branch.
 * It reads the default branch from `origin/HEAD` where none is named. With a
 * `State branch` key it fetches the state ref and the default branch, merges
 * both into HEAD so the push is a fast-forward of the state ref, and pushes at
 * the state ref. With no key it fetches the default branch, merges it into
 * HEAD, and pushes at the default branch; it refuses and pushes nothing where
 * HEAD's branch is not the default branch. Both pushes go through
 * `plot-push-main.sh`, which takes the push lock and pushes as the `Writer app`
 * on a GitHub origin where one is declared.
 *
 * The cut is {@link cutBooking}'s: from `origin/<default>` where no
 * `State branch` key is declared, else from the state ref with the default
 * branch merged in. It fetches `origin/<default>` first, so a caller needs no
 * fetch of its own. It runs once per operator command, which the cost rule
 * permits (`docs/shell-and-domain.md`).
 */

const USAGE = 'usage: plot-state-cut.mjs <worktree> <branch> <default-branch> | --land [<default-branch>]';

/**
 * Merges the target's tip into HEAD and pushes HEAD at the state ref, or at
 * the default branch where no `State branch` key is declared.
 *
 * @param named - the default branch's short name; `origin/HEAD`'s where absent.
 * @param cwd - the checkout holding the commit to push.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where the push report goes.
 * @param warn - where refusals go.
 * @returns the process exit code.
 */
const land = async (
  named: string | undefined,
  cwd: string,
  scriptDir: string,
  write: Printer,
  warn: Printer,
): Promise<number> => {
  const context = { repoRoot: cwd, scriptDir };
  const ctx: LadderContext = { repoRoot: cwd, scripts: scriptsShell(context), trees: treesGit(context) };
  try {
    const head = named ? null : await ctx.trees.originHead(cwd);
    const main = named || (head?.ok && head.value.trim() !== '' ? head.value.trim() : 'main');
    const target = await stateTargetOf(ctx, main);
    if (target === null) {
      const branch = await ctx.trees.currentBranch(cwd);
      if (!branch.ok || branch.value.trim() !== main) {
        const on = branch.ok ? (branch.value.trim() === '' ? 'a detached HEAD' : branch.value.trim()) : 'an unreadable branch';
        warn(`plot-state-cut: --land lands a default-branch checkout; HEAD is on ${on}, not ${main}. Nothing was pushed.\n`);
        return 1;
      }
    }
    const defaultRef = target?.defaultRef ?? `refs/remotes/origin/${main}`;
    const pushAt = target?.pushRef ?? main;
    const state = target === null ? null : await ctx.trees.fetchRef(cwd, target.pushRef, target.trackRef);
    const defaults = await ctx.trees.fetchRef(cwd, `refs/heads/${main}`, defaultRef);
    if ((state !== null && !state.ok) || !defaults.ok || (target === null && !defaults.value)) {
      warn(`plot-state-cut: could not ask the origin about ${target === null ? `refs/heads/${main}` : target.pushRef}; nothing was pushed\n`);
      return 1;
    }
    for (const ref of target !== null && state?.ok && state.value ? [target.trackRef, defaultRef] : [defaultRef]) {
      const merged = await ctx.trees.mergeIn(cwd, ref, 'plot');
      if (!merged.ok || merged.value.length > 0) {
        warn(`plot-state-cut: merging ${ref} into HEAD conflicts in ${merged.ok ? merged.value.join(', ') : 'an unreadable state'}; nothing was pushed\n`);
        return 1;
      }
    }
    const pushed = await pushUnderLock(ctx, 'HEAD', pushAt);
    write(`${pushed.stdout}`);
    warn(`${pushed.stderr}`);
    return pushed.code;
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-state-cut: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

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
  if (argv[0] === '--land') return land(argv[1], cwd, scriptDir, write, warn);
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
