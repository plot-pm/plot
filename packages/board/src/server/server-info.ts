import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BuildBoardOptions } from './board.js';
import type { ServerInfo } from '../contract/schema.js';

/**
 * What the page needs in order to name a way out when this server stops
 * answering: the command that starts it, and the port it bound.
 *
 * Its own module rather than a few lines in `board.ts`, because the two halves
 * come from different places and only one of them is plan data. The command is
 * read from the adopting project's `## Plot Config`; the port is known only
 * inside `listen()`, so it arrives as an argument from `index.ts` — the same
 * place `dispatch` is attached, and for the same reason.
 *
 * Both travel with the LAST SUCCESSFUL poll. A page whose server has died
 * cannot ask it anything, so whatever the overlay says must already be in
 * hand before the silence begins.
 */

/**
 * The `## Plot Config` key an adopting project uses to name its own start
 * command.
 *
 * The whole reason this is configuration rather than a constant: `pnpm board`
 * is *this* repo's convention (Principle 5 — Plot hardcodes no project
 * conventions). A project that starts its board with `npm run board`, `make
 * board` or a script of its own would otherwise read an overlay confidently
 * telling it to run something that does not exist.
 */
export const BOARD_COMMAND_KEY = 'Board command';

/**
 * The fallback when the project declares none.
 *
 * Empty, deliberately — NOT `pnpm board`. A guessed command is worse than no
 * command in exactly the case the overlay is for: a reader staring at a frozen
 * board, ready to believe the one instruction on screen. The overlay renders
 * the silence and the port without a command rather than inventing one, which
 * is the same rule `CardPrSchema` states for a PR with no reported URL.
 */
const NO_COMMAND = '';

/**
 * The branch this process serves, re-read on a short TTL.
 *
 * `serverInfo()` runs on every /api/board response, and this repo spent
 * measured effort taking a per-request `git` fork off that path
 * (`no-network.test.ts`). A process serves exactly one worktree for its whole
 * life — but that worktree can change BRANCH, so this is not a startup fact.
 * Cached for `BRANCH_TTL_MS` rather than forever: the fork stays off the
 * per-request path, and a checkout shows up within seconds.
 *
 * `git branch --show-current` prints the branch, or NOTHING for a detached
 * HEAD — several worktrees here are detached. Empty is the honest answer for
 * *detached or unreadable*: the header renders no element rather than inventing
 * a short SHA, which would read as a branch name to anyone skimming. Any
 * failure (not a git repo, git absent) lands on the same empty string, since
 * the page's response to *cannot say* is identical to its response to
 * *detached* — show nothing.
 */
let cachedBranch: string | null = null;
let cachedAt = 0;

/**
 * How long a read stands. Long enough that the per-request fork this file was
 * written to avoid stays avoided — a board polls /api/board every few seconds —
 * and short enough that a reader who switches branch sees it before deciding
 * the board is broken.
 */
const BRANCH_TTL_MS = 5_000;

function currentBranch(opts: BuildBoardOptions): string {
  // A PROCESS SERVES ONE WORKTREE, BUT A WORKTREE CHANGES BRANCH. The original
  // memo read once for the life of the server on the first half of that
  // sentence, which is true; the second half is what broke it.
  //
  // Measured 2026-08-25: clicking *Create plan* spawned an agent in the board's
  // own checkout, `/plot-idea` ran `git checkout -b idea/<slug>` there, and the
  // header went on reading `main` for the rest of the process's life. That is
  // the worst possible failure for THIS field — the checklist tells a reader to
  // trust the header when a row looks stale, so the one display kept as ground
  // truth was the one that had gone stale.
  //
  // The spawn is fixed in `idea.ts` (its own worktree), and this stays as well:
  // that fix stops the board's own agent from moving it, not a person running
  // `git checkout` in the same tree.
  const now = Date.now();
  if (cachedBranch === null || now - cachedAt > BRANCH_TTL_MS) {
    try {
      cachedBranch = execFileSync('git', ['branch', '--show-current'], {
        cwd: opts.repoRoot,
        encoding: 'utf8',
      }).trim();
    } catch {
      cachedBranch = '';
    }
    cachedAt = now;
  }
  return cachedBranch;
}

/** Read one `## Plot Config` key via the shared helper (with a default). */
function readConfig(opts: BuildBoardOptions, key: string, fallback: string): string {
  try {
    const out = execFileSync(
      'bash',
      [path.join(opts.scriptsDir, 'plot-config.sh'), 'get', key, fallback],
      { cwd: opts.repoRoot, encoding: 'utf8' },
    );
    return out.trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Assemble the server's self-description for the board payload.
 *
 * `port` must be the port actually BOUND, never the one requested: under
 * `PORT=0` they differ and the requested one is the literal 0, which would put
 * `localhost:0` in front of a reader as the address to go back to.
 */
export function serverInfo(opts: BuildBoardOptions, port: number): ServerInfo {
  return {
    restartCommand: readConfig(opts, BOARD_COMMAND_KEY, NO_COMMAND),
    port,
    // Memoised — this is a startup fact, so the fork stays off the request
    // path. Empty for a detached HEAD or an unreadable repo, which the header
    // renders as no element rather than a fabricated name.
    branch: currentBranch(opts),
    // A STARTUP FACT, like `branch`, and already resolved before the first
    // response — `repoRoot` is what every helper spawn is measured against, so
    // this reports a value the server already holds rather than computing one.
    repo: opts.repoRoot,
  };
}
