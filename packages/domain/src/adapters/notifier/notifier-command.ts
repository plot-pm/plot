import type { Notifier, NotifySendResult } from '../../ports/notifier.js';
import { runProcess } from '../run-script.js';

/** The environment variable the message is passed in. */
export const NOTIFY_MESSAGE_ENV = 'PLOT_NOTIFY_MESSAGE';

/** How long one notification may take before it is abandoned, in milliseconds. */
const NOTIFY_TIMEOUT_MS = 30_000;

/**
 * Runs a project's `Notify command` with the message in an environment
 * variable.
 *
 * **THE MESSAGE NEVER REACHES A SHELL.** `runProcess` spawns the configured
 * string directly as the program, with no arguments — never `sh -c command`,
 * and never the message interpolated into either. A branch name or a
 * question's first line is text an agent wrote, and running it through shell
 * source would execute whatever that agent wrote. The environment variable is
 * the one channel: a message holding `$(touch x)`, a backtick or a `;` is
 * bytes in `PLOT_NOTIFY_MESSAGE` and nothing a shell ever parses.
 *
 * **THE CONFIGURED STRING IS THE WHOLE PROGRAM, NOT A COMMAND LINE.** A
 * `Notify command` naming flags or arguments does not split here — same as
 * `Worker command` being handed to `plot-dispatch.sh`'s own `sh -c`, except
 * this adapter has no shell to split it for. A project whose command needs
 * arguments points at a wrapper script that reads `PLOT_NOTIFY_MESSAGE`
 * itself.
 *
 * @param command - the configured `Notify command`, trimmed and non-empty.
 * @returns a `Notifier` that runs it.
 */
export const notifierCommand = (command: string): Notifier => ({
  notify: async (message): Promise<NotifySendResult> => {
    const run = await runProcess(command, [], {
      env: { [NOTIFY_MESSAGE_ENV]: message },
      timeoutMs: NOTIFY_TIMEOUT_MS,
    });
    return run.code === 0 ? { ok: true } : { ok: false, why: 'failed', code: run.code };
  },
});
