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
  };
}
