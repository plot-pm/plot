import type { PortResult } from '../port-result.js';

/**
 * What became of one send — `PortResult`'s own three outcomes plus the one
 * fact `.plot/state/escalations.tsv` needs that a bare `failed` cannot carry:
 * the exit code.
 *
 * **NOT {@link PortResult}.** That type's `failed` carries no payload, and the
 * TSV record is `sent`, `unaskable` or `failed <code>` — a broken command's
 * own exit code, so a person reading the file sees WHICH failure repeated
 * rather than only that one did.
 */
export type NotifySendResult =
  | { ok: true }
  | { ok: false; why: 'unaskable' }
  | { ok: false; why: 'failed'; code: number };

/**
 * Sends one message to a person — the one write an escalation makes outside
 * the estate.
 *
 * **ONE OPERATION, BECAUSE THAT IS THE WHOLE OF WHAT A RUNG NEEDS.** A reached
 * rung has one fact to deliver — a desk's question has aged past a threshold —
 * and no reply to read, no thread to continue and no recipient to choose: the
 * project's `Notify command` already encodes who hears it and how.
 *
 * **NO `Notify command` IS `unaskable`, NEVER A FAILURE.** A repository that
 * declared no command has not failed to notify anyone; it has chosen the board
 * listing as its one escalation, the same first-class absence `trackerNone`
 * answers for a tracker nobody configured.
 */
export interface Notifier {
  /**
   * Sends one message.
   *
   * @param message - the text to send, verbatim — never interpolated into a
   *   shell, so a message holding `$(...)`, a backtick or a `;` runs nothing.
   * @returns `unaskable` where no `Notify command` is configured; `failed`
   *   with the exit code where the command ran and exited non-zero.
   */
  notify(message: string): Promise<NotifySendResult>;
}
