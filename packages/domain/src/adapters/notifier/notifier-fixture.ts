import type { Notifier, NotifySendResult } from '../../ports/notifier.js';

/** What a fixture notifier answers from. */
export interface NotifierFixture {
  /** Every message sent, in call order. */
  sent?: string[];
  /** Whether every call answers `unaskable`, as a repository with no command does. */
  unconfigured?: boolean;
  /** The exit code every call fails with; `0` (the default) means every call answers. */
  failCode?: number;
}

/**
 * A `Notifier` that answers from values, reaching nothing.
 *
 * Beside {@link notifierCommand}, which spawns a real process — a test
 * asserting what a message reaches needs one that reaches nothing instead.
 *
 * @param fixture - the notifier to answer from.
 * @returns a `Notifier` backed by those values.
 */
export const notifierFixture = (fixture: NotifierFixture = {}): Notifier => {
  const sent = fixture.sent ?? [];
  const failCode = fixture.failCode ?? 0;
  return {
    notify: async (message): Promise<NotifySendResult> => {
      if (fixture.unconfigured === true) return { ok: false, why: 'unaskable' };
      // RECORDED BEFORE IT REFUSES, like `trackerFixture.statusWrite`: a
      // failed send was still an attempt, and a test asserting a repository
      // with a broken command still tried must be able to see it.
      sent.push(message);
      if (failCode !== 0) return { ok: false, why: 'failed', code: failCode };
      return { ok: true };
    },
  };
};
