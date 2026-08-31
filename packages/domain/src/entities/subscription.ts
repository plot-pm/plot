import { z } from 'zod';
import { FindingNameSchema, type Finding, type FindingName } from './finding.js';

/**
 * Why a subscriber connected.
 *
 * The purpose IS the subscription, not a filter on top of one. A subscriber
 * with a narrow purpose is finished when it is served and the channel stops
 * carrying it; one whose purpose is `everything` stays as long as it listens.
 *
 * That both kinds fall out of one mechanism is the argument for the shape. The
 * board's purpose is the degenerate case — `everything`, forever — and it needed
 * no second mechanism to express.
 */
export const PurposeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('everything') }),
  z.object({
    kind: z.literal('until'),
    /**
     * The finding that, once seen, serves this subscriber and ends it.
     *
     * Every finding a monitor publishes EXCEPT `clear`: the publishing
     * vocabulary and the waitable one are different sets. A retraction is a
     * condition ceasing to hold, so waiting for one is waiting for nothing in
     * particular — and a subscriber that asked would never be served.
     */
    finding: FindingNameSchema.exclude(['clear']),
    /** The branch it must hold for; `''` means any branch. */
    branch: z.string().default(''),
  }),
]);
export type Purpose = z.infer<typeof PurposeSchema>;

/**
 * What a subscriber sent to open a subscription.
 *
 * The purpose is not validated here — an unparseable or unmeasured purpose is
 * refused by `admit`, which can name what it cannot serve. Parsing that threw
 * would lose the name and leave the subscriber with a closed socket and no
 * reason for it.
 */
export const SubscribeRequestSchema = z.object({
  /** The subscriber's own name, for the log. Free text; nothing depends on it. */
  subscriber: z.string().default(''),
  purpose: PurposeSchema,
});
export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;

/**
 * A live subscription: a purpose, and who to send to.
 *
 * Identity is the connection, which the adapter holds. This carries only what
 * the protocol reasons about, so every decision below is testable without a
 * socket.
 */
export interface Subscription {
  /** The connection's id, assigned by the adapter that accepted it. */
  id: string;
  /** The subscriber's own name, for the log. */
  subscriber: string;
  /** Why it connected. */
  purpose: Purpose;
}

/** A purpose was accepted, and here is what to send it now. */
export interface Admitted {
  ok: true;
  subscription: Subscription;
}

/** A purpose was refused, and here is what could not be served. */
export interface PurposeRefused {
  ok: false;
  /** Why, in a sentence a subscriber can print. */
  reason: string;
  /** The condition asked for, when there was a nameable one. */
  asked: string;
  /** What this channel does measure — so a refusal teaches. */
  measurable: readonly FindingName[];
}

export type Admission = Admitted | PurposeRefused;

/**
 * Does this finding serve this purpose?
 *
 * `everything` is served by every finding and is never finished by one, which
 * is the whole of the degenerate case. An `until` purpose is served by its own
 * finding on its own branch — and a `clear` never serves one, because a
 * retraction is the condition ceasing to hold rather than holding.
 */
export const serves = (purpose: Purpose, finding: Finding): boolean => {
  if (purpose.kind === 'everything') return true;
  if (finding.finding !== purpose.finding) return false;
  return purpose.branch === '' || purpose.branch === finding.branch;
};

/**
 * Is this subscription finished, having been served?
 *
 * Only an `until` purpose can finish. `everything` ends when its subscriber
 * disconnects and in no other way — a channel that retired the board's
 * subscription because it had sent it something would be a channel the board
 * has to reconnect to after every finding.
 */
export const isServed = (purpose: Purpose, finding: Finding): boolean =>
  purpose.kind === 'until' && serves(purpose, finding);
