import type { Notifier, NotifySendResult } from '../../ports/notifier.js';
import { runProcess } from '../run-script.js';

/** The environment variable the message is passed in. */
export const NOTIFY_MESSAGE_ENV = 'PLOT_NOTIFY_MESSAGE';

/** How long one notification may take before it is abandoned, in milliseconds. */
const NOTIFY_TIMEOUT_MS = 30_000;

/**
 * Runs a project's `Notify command` through `sh -c`, as `Worker command` is
 * run, with the message in the `PLOT_NOTIFY_MESSAGE` environment variable.
 *
 * The configured command is the only shell source. The message is never
 * interpolated into it: a message holding `$(…)`, a backtick or a `;` reaches
 * the command as the bytes of one environment variable, and the shell parses
 * none of it. A command with arguments (`notify-send -u critical Plot`) runs
 * as written.
 *
 * @param command - the configured `Notify command`, trimmed and non-empty.
 * @returns a `Notifier` that runs it, bounded at 30 seconds per call. The
 *   result is `{ ok: true }` on exit 0, and `failed` with the exit code
 *   otherwise; a command that cannot start or times out answers a non-zero code.
 */
export const notifierCommand = (command: string): Notifier => ({
  notify: async (message): Promise<NotifySendResult> => {
    const run = await runProcess('sh', ['-c', command], {
      env: { [NOTIFY_MESSAGE_ENV]: message },
      timeoutMs: NOTIFY_TIMEOUT_MS,
    });
    return run.code === 0 ? { ok: true } : { ok: false, why: 'failed', code: run.code };
  },
});
