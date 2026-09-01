import type { ChannelMessage, Finding } from '@plot-pm/domain';
import { subscribe } from '@plot-pm/domain/adapters';
import {
  actOnFinding,
  newActedMemory,
  type ActedMemory,
  type ActingOutcome,
  type ActingPorts,
} from '../controllers/acting.js';

/**
 * The master agent's subscription, and the one act it takes.
 *
 * IT SUBSCRIBES WITH A PURPOSE AND ACTS ON `owes a review`. Nothing else here
 * acts on anything: the monitors report, the board renders, and this is the one
 * reader that does something about what it hears.
 *
 * IT ASKS THROUGH THE CONTROLLER. No second entry point to the domain — the
 * decision is `rules/acting.ts`'s, the readings and the write are the
 * controller's, and this module owns only the subscription and the loop.
 */

/** Where to listen, and how the agent names itself in the log. */
export interface ActingOptions {
  /** The channel's socket path. */
  address: string;
  /** The subscriber's name, for the log. */
  subscriber?: string;
  /**
   * The branch to wait for, or `''` for every branch.
   *
   * A NARROW PURPOSE STILL ENDS ITSELF. The channel serves an `until` purpose
   * once and closes it, so an agent naming one branch acts once and stops —
   * which is what an agent sequencing its own work wants. An agent minding the
   * whole fleet names none and stays.
   */
  branch?: string;
}

/** The agent, once it is listening. */
export interface ActingAgent {
  /** Stop listening. */
  close(): void;
  /** Every finding this run acted on or declined, in arrival order. */
  outcomes(): readonly ActingOutcome[];
  /** What this run has already opened, so a caller can inspect the idempotence. */
  memory: ActedMemory;
}

/**
 * Subscribe, and open a PR for every branch that owes a review.
 *
 * THE PURPOSE IS `until owes a review`, which is the vocabulary the channel
 * already measures. A purpose it does not measure is refused on the request
 * rather than left pending — so the refusal, if it ever comes, arrives as an
 * `onEnd` with a reason rather than as an agent waiting forever.
 *
 * ACTS ARE SERIALISED. `actOnFinding` reads the host and then writes to it, and
 * two of those interleaved on one branch would each read *no PR* before either
 * wrote one — the same double-open the memory prevents between messages,
 * arriving inside a single one. The queue below is what makes the memory's
 * check-then-act atomic.
 *
 * @param ports the readings and the write
 * @param options where to listen and for what
 * @param onOutcome called after each finding is decided, for the log
 * @returns the handle to stop it with
 */
export const actOnFindings = (
  ports: ActingPorts,
  options: ActingOptions,
  onOutcome: (outcome: ActingOutcome) => void = () => undefined,
): ActingAgent => {
  const memory = newActedMemory();
  const seen: ActingOutcome[] = [];
  let queue: Promise<void> = Promise.resolve();

  const handle = (finding: Finding): void => {
    queue = queue.then(async () => {
      const outcome = await actOnFinding(ports, memory, finding);
      seen.push(outcome);
      onOutcome(outcome);
    });
  };

  const connection = subscribe(
    {
      address: options.address,
      subscriber: options.subscriber ?? 'master-agent',
      purpose: { kind: 'until', finding: 'owes a review', branch: options.branch ?? '' },
    },
    (message: ChannelMessage) => {
      // THE WELCOME CARRIES THE CURRENT STATE, not a replay, so a late
      // subscriber acts on debts that were already true when it connected —
      // which is the case the two measured stalls were: the work had been
      // finished for minutes before anyone looked.
      if (message.type === 'welcome') for (const finding of message.current) handle(finding);
      if (message.type === 'finding') handle(message.finding);
      if (message.type === 'served') handle(message.finding);
    },
  );

  return {
    close: () => connection.close(),
    outcomes: () => seen,
    memory,
  };
};

/**
 * Act on one already-received finding.
 *
 * The same controller call the subscription makes, exposed for the caller that
 * holds a finding from somewhere else — a monitor log the board already read,
 * say. It shares the memory, so a branch acted on here is not acted on again by
 * the subscription.
 *
 * @param ports the readings and the write
 * @param memory what this run has already opened
 * @param finding the finding to act on
 * @returns what was decided, and what it did
 */
export const actOnOne = (
  ports: ActingPorts,
  memory: ActedMemory,
  finding: Finding,
): Promise<ActingOutcome> => actOnFinding(ports, memory, finding);

export { newActedMemory };
export type { ActedMemory, ActingOutcome, ActingPorts };
