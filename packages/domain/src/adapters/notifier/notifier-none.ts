import type { Notifier, NotifySendResult } from '../../ports/notifier.js';

/**
 * A repository that declared no `Notify command`.
 *
 * **ALWAYS `unaskable`, NEVER A FAILURE.** A repository with no command has
 * not failed to notify anyone — it has chosen the board listing as its one
 * escalation, same as {@link trackerNone} for a tracker nobody configured. A
 * caller that mapped this to `sent` would report a message reaching somebody
 * while nothing left the machine.
 *
 * @returns a `Notifier` that reaches nothing and says so.
 */
export const notifierNone = (): Notifier => ({
  notify: async (): Promise<NotifySendResult> => ({ ok: false, why: 'unaskable' }),
});
