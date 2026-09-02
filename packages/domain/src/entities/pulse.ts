/**
 * A machine's clock: it beats once, and every subscriber names how many beats
 * it waits.
 *
 * Spec: `docs/stories/the-master-agent-holds-the-fleet/DESIGN-pulse.md`.
 *
 * This module holds the COUNTING and nothing else. The beat's arrival is the
 * `Clock` port's (`ports/clock.ts` `schedule`), so every property below —
 * which subscribers are due, what a failing one costs its neighbours — is
 * assertable by calling `beat` twelve times with no timer in scope.
 *
 * {@link startPulse} is the one function here that holds the port, and it holds
 * only the interface — the type, never an adapter, so the dependency still
 * points inward.
 */
import type { Cancel, Clock } from '../ports/clock.js';

/**
 * Something that counts beats, and what to run when its turn comes.
 *
 * `everyNthBeat` is a divisor and not a duration. The base is one session's
 * measurement and the ratios are the design, so a subscriber that named
 * `60_000` would have to be re-derived every time the base moved.
 */
export interface Subscriber {
  /** Who, for the log. Free text; nothing decides on it. */
  name: string;
  /** How many beats between runs. `1` is every beat; must be >= 1. */
  everyNthBeat: number;
  /**
   * What to run when the divisor comes up.
   *
   * Its failure is contained: a throw is caught, and a returned promise is
   * never awaited. See {@link beat}.
   */
  tick: () => void | Promise<void>;
}

/**
 * A clock that is beating, and who is counting its beats.
 *
 * Identity is its Machine's — there is exactly one pulse per Plot instance, so
 * naming the machine names the clock. `beatCount` is the whole of the state: it
 * only rises, it is not persisted, and a restart begins at zero.
 */
export interface Pulse {
  /** The base, in milliseconds. Every divisor is expressed against it. */
  intervalMs: number;
  /** Beats since this clock started. Monotonic, from 0. */
  beatCount: number;
  /** When this clock began, as epoch milliseconds. A restart resets it. */
  startedAt: number;
  /** Who is counting, and by what. */
  subscribers: readonly Subscriber[];
}

/**
 * How a subscriber's tick ended, for the caller that logs it.
 *
 * A beat reports rather than reacts. The pulse does not retry — the next beat
 * is the retry and it is already scheduled — so this exists to be logged and
 * asserted on, never to drive a decision inside the clock.
 */
export interface TickOutcome {
  /** The subscriber whose turn it was. */
  name: string;
  /** The error it threw synchronously, or null when it returned. */
  error: unknown;
}

/** What one beat did: which subscribers ran, and which of them threw. */
export interface Beat {
  /** The clock after the beat; `beatCount` is one higher. */
  pulse: Pulse;
  /** Every subscriber whose divisor came up, in subscription order. */
  ran: readonly TickOutcome[];
}

/**
 * Builds a stopped clock at beat zero.
 *
 * @param intervalMs - the base, in milliseconds.
 * @param startedAt - when the clock began, as epoch milliseconds.
 * @returns a pulse with no subscribers and a `beatCount` of 0.
 */
export const createPulse = (intervalMs: number, startedAt: number): Pulse => ({
  intervalMs,
  beatCount: 0,
  startedAt,
  subscribers: [],
});

/**
 * How many beats a duration is, against this clock's base.
 *
 * The divisors are DERIVED, not configured: `12` is right only because the base
 * is 5 s, so a caller that knows a subscriber's period in milliseconds asks for
 * its divisor rather than writing one down. Move the base and every divisor
 * moves with it.
 *
 * Rounds to the nearest beat and never below 1. A period shorter than the base
 * cannot be honoured by a clock that beats at the base — it becomes every beat,
 * which is the closest cadence that exists rather than a division by zero.
 *
 * @param pulse - the clock whose base the duration is measured against.
 * @param periodMs - the cadence wanted, in milliseconds.
 * @returns the divisor, at least 1.
 */
export const divisorFor = (pulse: Pulse, periodMs: number): number =>
  Math.max(1, Math.round(periodMs / pulse.intervalMs));

/**
 * Adds a subscriber, its divisor rounded down to a whole beat and never below 1.
 *
 * A fractional divisor has no beat that satisfies it and `0` would make every
 * beat a modulo by zero, so both are clamped here rather than stored and left
 * to fire never or always. Clamped rather than refused because the caller has
 * no better answer than the nearest cadence that exists — and a subscriber
 * dropped for an arithmetic detail is a poller that silently stops.
 *
 * The new subscriber is NOT run now and is owed nothing for the beats before
 * it: one that joins at beat 400 with divisor 6 waits for 402. Catch-up would
 * replay questions whose answers have already changed — every current
 * subscriber asks *what is true now* — and would let subscribing trigger an
 * 18.3 s scan at an unpredictable moment.
 *
 * @param pulse - the clock to add to.
 * @param subscriber - who is counting, and by what.
 * @returns a new pulse carrying the subscriber, its divisor whole and >= 1.
 */
export const addSubscriber = (pulse: Pulse, subscriber: Subscriber): Pulse => ({
  ...pulse,
  subscribers: [
    ...pulse.subscribers,
    { ...subscriber, everyNthBeat: Math.max(1, Math.floor(subscriber.everyNthBeat)) },
  ],
});

/**
 * Removes every subscriber of this name.
 *
 * By name rather than by identity, because the caller that unsubscribes is
 * rarely the closure that subscribed. A name nobody holds removes nothing and
 * is not an error — there is no state to be wrong about.
 *
 * @param pulse - the clock to remove from.
 * @param name - the subscriber name to drop.
 * @returns a new pulse without those subscribers.
 */
export const removeSubscriber = (pulse: Pulse, name: string): Pulse => ({
  ...pulse,
  subscribers: pulse.subscribers.filter((s) => s.name !== name),
});

/**
 * Is this subscriber's turn the given beat?
 *
 * `beatCount % everyNthBeat === 0`, and beat 0 is therefore every subscriber's
 * turn. The board already relies on that: both sources are warmed at startup so
 * the first person to open the tab does not wait a minute for PR data.
 *
 * @param subscriber - the subscriber whose divisor to test.
 * @param beatCount - the beat number.
 * @returns true when the divisor comes up on this beat.
 */
export const isDue = (subscriber: Subscriber, beatCount: number): boolean =>
  beatCount % subscriber.everyNthBeat === 0;

/**
 * Which subscribers a beat is for.
 *
 * @param pulse - the clock, whose `beatCount` is the beat about to be counted.
 * @returns the due subscribers, in subscription order.
 */
export const dueSubscribers = (pulse: Pulse): readonly Subscriber[] =>
  pulse.subscribers.filter((s) => isDue(s, pulse.beatCount));

/**
 * Beats once: runs every due subscriber, and raises the count.
 *
 * **A FAILING SUBSCRIBER CANNOT DELAY ANOTHER'S BEAT.** That is the invariant
 * this function exists for, not a quality it happens to have.
 * `fleet.ts` records why the two timers were split in the first place:
 *
 * > *Its own timer, because its own clock: git is local and free at 5 s, the
 * > host is metered and pointless below a minute. They failed independently
 * > already; now they also fire independently.*
 *
 * A shared clock that re-couples them would make this design a regression, so
 * the isolation is mechanical here:
 *
 * - **Nothing is awaited.** A subscriber's promise is detached and its
 *   rejection is handled where it is detached, so one that never returns holds
 *   only itself. This function is synchronous for exactly that reason — an
 *   `async` beat would invite an `await` into the loop, and one `await` is the
 *   whole coupling back.
 * - **A throw is caught per subscriber, not per beat.** One that throws on
 *   every beat is a subscriber with a bug, not a stopped clock, and the
 *   subscribers after it in the list still run on the same beat.
 * - **Nothing is retried and nothing is queued.** The next beat is the retry.
 *   A pulse that queued a skipped turn would convert one slow subscriber into
 *   an ever-growing backlog — the coupling again, arriving as a helpful
 *   feature. Re-entrancy is the subscriber's own concern.
 *
 * @param pulse - the clock to beat.
 * @returns the clock one beat on, and what each due subscriber's tick did.
 */
export const beat = (pulse: Pulse): Beat => {
  const ran = dueSubscribers(pulse).map((s) => runTick(s));
  return { pulse: { ...pulse, beatCount: pulse.beatCount + 1 }, ran };
};

/**
 * Runs one tick with its failure contained.
 *
 * A synchronous throw becomes an outcome; an async rejection is swallowed at
 * the detached promise, because there is no beat left to report it to by the
 * time it arrives. Neither reaches the caller, which is what keeps one
 * subscriber's bug off every other subscriber's cadence.
 */
const runTick = (subscriber: Subscriber): TickOutcome => {
  try {
    // NOT awaited, and the `void` is the invariant rather than a lint fix: a
    // hanging subscriber must hold only itself.
    void Promise.resolve(subscriber.tick()).catch(() => undefined);
    return { name: subscriber.name, error: null };
  } catch (error) {
    return { name: subscriber.name, error };
  }
};

/**
 * A pulse that is beating, and the handle its owner holds.
 *
 * The pure functions above are the design; this is the one mutable thing,
 * because a clock IS mutable — `beatCount` rises and the caller does not thread
 * a new pulse through a timer callback.
 */
export interface RunningPulse {
  /** Adds a subscriber. It waits for its next multiple; nothing is owed. */
  add: (subscriber: Subscriber) => void;
  /** Removes every subscriber of this name. */
  remove: (name: string) => void;
  /** The clock as it stands — for a reader, never for a decision inside it. */
  reading: () => Pulse;
  /** Stops the clock. Calling it twice is not an error. */
  stop: Cancel;
}

/**
 * Starts one clock and returns the handle to it.
 *
 * **THE ONE PLACE THE PORT IS NEEDED.** Every property of the divisor model is
 * decided by {@link beat}, which is pure; this supplies the only thing the
 * domain cannot compute — a beat ARRIVING. `DESIGN-pulse.md` §9 states the
 * asymmetry: every other port answers *where does this fact come from*, and a
 * beat comes from nowhere, so the pulse's port is a scheduler rather than a
 * reader.
 *
 * The schedule is made ONCE, at the base, and the divisors are counted against
 * it. That is what makes the ratios the design and the base a number that can
 * be re-measured — a second schedule per subscriber would be the three timers
 * back, wearing one entity's name.
 *
 * @param clock - the port that supplies beats and the current time.
 * @param intervalMs - the base, in milliseconds.
 * @param onBeat - called after each beat with what its subscribers did.
 *   Optional: for a log, and a caller with nothing to log passes nothing.
 * @returns the handle: subscribe, unsubscribe, read, stop.
 */
export const startPulse = (
  clock: Clock,
  intervalMs: number,
  onBeat?: (beat: Beat) => void,
): RunningPulse => {
  // `valueOr` is not used: an unanswerable `now` is not a reason to refuse to
  // beat, and `startedAt` is a report rather than an operand. Every divisor
  // reads `beatCount`, which starts at 0 whatever the wall clock says.
  const started = clock.now();
  let pulse = createPulse(intervalMs, started.ok ? started.value : 0);
  const cancel = clock.schedule(intervalMs, () => {
    const beaten = beat(pulse);
    // Assigned BEFORE the log, so a throwing `onBeat` cannot stop the count.
    // The same isolation the subscribers get, applied to the observer: nothing
    // a caller passes here may become a reason the clock stops.
    pulse = beaten.pulse;
    try {
      onBeat?.(beaten);
    } catch {
      // A logger's failure is not the clock's. There is nowhere left to report
      // it — reporting is what just failed.
    }
  });
  return {
    add: (subscriber) => {
      pulse = addSubscriber(pulse, subscriber);
    },
    remove: (name) => {
      pulse = removeSubscriber(pulse, name);
    },
    reading: () => pulse,
    stop: cancel,
  };
};
