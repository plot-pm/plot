import { planStoreFor, treesFor } from './board.js';
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
 * `Trees.currentBranch` answers the branch, or `''` for a detached HEAD —
 * several worktrees here are detached. Empty is the honest answer for
 * *detached or unreadable*: the header renders no element rather than inventing
 * a short SHA, which would read as a branch name to anyone skimming. A port
 * that cannot answer at all (not a git repo, git absent) lands on the same
 * empty string, since the page's response to *cannot say* is identical to its
 * response to *detached* — show nothing. The port keeps the two DISTINGUISHABLE
 * in `ok`, which the old `execFileSync` did not; this caller is one that has
 * decided the distinction does not change what it renders.
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

async function currentBranch(opts: BuildBoardOptions): Promise<string> {
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
    // THE SERVER'S OWN CHECKOUT, asked by path. `Trees.list()` would answer it
    // too, and `fleet.ts` uses that call for the MAIN checkout — but finding
    // this tree in a listing means comparing `opts.repoRoot` against git's
    // reported path, and a temporary directory is a symlink on macOS, so the
    // two spellings of one path would not match. `currentBranch(path)` asks
    // about one checkout and needs no comparison.
    const read = await treesFor(opts).currentBranch(opts.repoRoot);
    cachedBranch = read.ok ? read.value : '';
    cachedAt = now;
  }
  return cachedBranch;
}

/**
 * Read one `## Plot Config` key through the `PlanStore` port (with a default).
 *
 * `plan-store.config(key, fallback)` is the async twin of the `execFileSync`
 * that ran here until 2026-09-01. The port already applies the fallback for an
 * absent key, so a non-answer and an empty answer land on the same value —
 * which is what this caller wants, because {@link NO_COMMAND} is what the
 * overlay renders when it has no command to name and a guessed command is
 * worse than none.
 */
const readConfig = async (
  opts: BuildBoardOptions,
  key: string,
  fallback: string,
): Promise<string> => {
  const read = await planStoreFor(opts).config(key, fallback);
  return (read.ok ? read.value.trim() : '') || fallback;
};

/** The `## Plot Config` key naming the repository's CI system. */
const CI_KEY = 'CI';

/**
 * The CI system this repository declared, read ONCE for the process's life.
 *
 * A STARTUP FACT, unlike `branch`. A process serves one worktree, and that
 * worktree's `CI` key does not change under it the way its checked-out branch
 * does — so this is memoised outright rather than on a TTL, and the spawn stays
 * off the `/api/board` path this file exists to keep clear.
 *
 * AN UNREADABLE KEY IS `''`, which `checksUnaskableNote` renders as the unnamed
 * sentence. A board that could not read the key knows less than one that did,
 * and naming a system it never read would be worse than naming none.
 */
let cachedCi: string | null = null;

/**
 * What a person calls each CI system, keyed by the word its config uses.
 *
 * THE VENDOR NAMES LIVE HERE AND NOT IN THE RULE — the same split
 * `entry/stack-readings.ts` already makes, and CI's *domain names no vendor*
 * gate enforces. `github-actions` is a key's VALUE; `GitHub Actions` is what a
 * reader calls it, and a board printing the key makes its reader translate.
 *
 * A SYSTEM THAT IS NOT LISTED IS SHOWN AS ITSELF. A repository may declare a CI
 * Plot has no connector for, and printing that word back is honest where a
 * placeholder would hide which system was asked. So a third CI system needs an
 * entry here to read well, and needs nothing anywhere to work.
 */
const CI_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'github-actions': 'GitHub Actions',
  jenkins: 'Jenkins',
};

const ciSystem = async (opts: BuildBoardOptions): Promise<string> => {
  if (cachedCi === null) {
    const declared = await readConfig(opts, CI_KEY, '');
    const key = declared.trim().toLowerCase();
    cachedCi = key === '' ? '' : (CI_DISPLAY_NAMES[key] ?? declared.trim());
  }
  return cachedCi;
};

/**
 * Assemble the server's self-description for the board payload.
 *
 * `port` must be the port actually BOUND, never the one requested: under
 * `PORT=0` they differ and the requested one is the literal 0, which would put
 * `localhost:0` in front of a reader as the address to go back to.
 */
export async function serverInfo(
  opts: BuildBoardOptions,
  port: number,
): Promise<ServerInfo> {
  // ASKED TOGETHER, because neither answer depends on the other. Both used to
  // be synchronous spawns on the `/api/board` path, which is the defect this
  // migration exists for: a synchronous spawn cannot yield, so the loop served
  // nothing while either ran.
  const [restartCommand, branch, ci] = await Promise.all([
    readConfig(opts, BOARD_COMMAND_KEY, NO_COMMAND),
    currentBranch(opts),
    ciSystem(opts),
  ]);
  return {
    restartCommand,
    port,
    // Memoised on a 5 s TTL. Empty for a detached HEAD or an unreadable repo,
    // which the header renders as no element rather than a fabricated name.
    branch,
    // A STARTUP FACT, like `branch`, and already resolved before the first
    // response — `repoRoot` is what every helper spawn is measured against, so
    // this reports a value the server already holds rather than computing one.
    repo: opts.repoRoot,
    // MEMOISED FOR THE PROCESS, not per request: a worktree's `CI` key is a
    // startup fact. Empty where none is declared or the key is unreadable, and
    // the board then says the unnamed sentence rather than naming a guess.
    ci,
  };
}
