/**
 * Asking for a hand-off brief — the spawn auto-dispatch makes when it skips a
 * plan as `no-brief`.
 *
 * **ASK, DO NOT AWAIT.** The caller reports that it asked; it never waits for
 * the brief. `plot-dispatch.sh` states the same distinction for the shell side
 * — *"`brief_asked=N` COUNTS COMMANDS STARTED, NEVER BRIEFS WRITTEN."* A pass
 * that blocked on one `claude -p` session of unknown length would hold every
 * later branch behind it, and the brief has to reach `origin/main` before a
 * claim can happen anyway.
 *
 * A leaf module beside {@link ./brief-path.js} for the same reason that one is
 * one: the spawn is the only impure thing here, and keeping it out of
 * `auto-dispatch.ts` leaves that file's own rule intact — every read and write
 * in `maybeAutoDispatch`, and `planAutoDispatch` pure.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { readConfig, type BuildBoardOptions } from './board.js';
import { usableCommand } from './idea.js';
import { briefPath } from './brief-path.js';

/** The `## Plot Config` key naming the command that writes a brief. */
export const BRIEF_COMMAND_KEY = 'Brief command';

/**
 * The configured brief command, or `''` when there is none to run.
 *
 * **READ FRESH EVERY PASS, never cached at startup**, the rule
 * `readFleetSettings` already follows: a key added while the board runs takes
 * effect on the next pulse rather than on the next restart.
 *
 * `none` answers `''` through {@link usableCommand} — the repo's established
 * spelling for *asked, and we do this by hand*. Running it would spawn `none:
 * command not found` and log that as the reason a brief does not exist.
 *
 * @param opts - the board's options, carrying the repo root and scripts dir.
 * @returns the command as a shell fragment, or `''` when unset or `none`.
 */
export const briefCommand = (opts: BuildBoardOptions): string =>
  usableCommand(readConfig(opts, BRIEF_COMMAND_KEY, ''));

/**
 * What the brief writer is told to do.
 *
 * **IT ASKS FOR `/plot-implement`, AND NEVER FOR A BRIEF IN THE AGENT'S OWN
 * WORDS.** `/plot-implement` step 4 owns brief authorship; a prompt describing
 * the brief here would be a second author, and the two would drift. The wording
 * matches `brief_prompt()` in `plot-dispatch.sh` because the two ask the same
 * thing of the same skill.
 *
 * **IT SAYS COMMIT AND PUSH, because the gate reads `origin/<main>`.** A brief
 * left in a working tree is invisible to the gate that asked for it, so the next
 * pass would ask again — writing a file every pulse and never starting a worker.
 *
 * @param slug - the plan slug, as `/plot-implement` takes it.
 * @param branch - the branch whose brief is missing.
 * @param main - the default branch's name, as the pulse reports it.
 * @returns the prompt, as one argument.
 */
export const briefAskPrompt = (slug: string, branch: string, main: string): string =>
  `/plot-implement ${slug} — write the hand-off brief for branch \`${branch}\` at ` +
  `${briefPath(branch)}, then commit and push it to ${main}. The dispatch gate reads ` +
  `that path on origin/${main}, so a brief left uncommitted is invisible to it.`;

/**
 * Runs the configured brief command for one plan, detached, and returns.
 *
 * **THE COMMAND IS A SHELL FRAGMENT AND THE PROMPT IS AN ARGUMENT.** The shape
 * is `approve.ts:294`'s, and the safety is in the shape rather than in the
 * input: the configured command is interpolated because a fragment is what the
 * key holds, while the prompt travels through `"$@"` and so cannot be read as
 * shell however it is spelt.
 *
 * **`detached` WITH `unref`, and that differs from `approve.ts` deliberately.**
 * That one keeps its handle because its card is waiting on the exit code —
 * dropping it would make every approval read `running` forever. Nothing waits on
 * this one: the next pulse reads `origin/<main>` for the brief, not this
 * process's status, so the board must be free to exit without taking a brief
 * session down with it.
 *
 * **A spawn failure is reported and never thrown.** This runs inside the scan's
 * success path, and an unspawnable command must not take a pulse down with it —
 * the plan stays `no-brief` and the next pass asks again.
 *
 * @param opts - the board's options; the command runs from the repo root.
 * @param command - the configured fragment, already checked usable.
 * @param slug - the plan slug, for the prompt and the log path.
 * @param prompt - the assembled prompt, passed as one argument.
 * @returns the log path the session writes to, or `''` when the spawn failed.
 */
export const askForBrief = (
  opts: BuildBoardOptions,
  command: string,
  slug: string,
  prompt: string,
): string => {
  const log = path.join(opts.repoRoot, `.plot-brief-${slug}.log`);
  try {
    const out = fs.openSync(log, 'a');
    try {
      const child = spawn('sh', ['-c', `${command} "$@"`, 'plot-brief', prompt], {
        cwd: opts.repoRoot,
        detached: true,
        stdio: ['ignore', out, out],
      });
      // A LISTENER SO A FAILED SPAWN CANNOT BECOME AN UNCAUGHT `error` EVENT.
      // Nothing acts on it — the pulse has already moved on and the next one
      // re-reads git — but an unhandled `error` on a child process takes the
      // board's process down, which is the one outcome worse than no brief.
      child.on('error', (err) => {
        console.log(`auto-dispatch: brief command for ${slug} failed to start: ${err.message}`);
      });
      child.unref();
    } finally {
      fs.closeSync(out);
    }
    return log;
  } catch (err) {
    console.log(
      `auto-dispatch: could not ask for ${slug}'s brief: ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  }
};
