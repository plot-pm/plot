import type { Clock } from '@plot-pm/domain/ports/clock';

/** What the wait reads each time it starts. */
export interface TickWaitInput {
  /** The earliest wall time a deadline the tick owns can change its answer, epoch milliseconds; `null` holds none. */
  deadlineAt: number | null;
  /** Whether a watch is degraded or absent: the wait then also ends `intervalMs` after the first answer of `true`. Read at the start and on every `recheck`. */
  degraded: () => boolean;
  /** The `--interval` cadence, milliseconds: the degraded cadence, and the delay where the clock does not answer. */
  intervalMs: number;
  /** Settles on a stop request; the wait ends with it. */
  requested: Promise<void>;
}

/** The supervision tick's wait. */
export interface TickWake {
  /** Names a trigger. A trigger that arrives with no wait running ends the next wait at once. */
  trigger: () => void;
  /** Forgets triggers named before the tick that is starting: that tick reads what they named. */
  clear: () => void;
  /** Reads `degraded` again for the running wait; a watch that degraded during the wait starts the interval. */
  recheck: () => void;
  /**
   * Waits for the first of a trigger, the deadline, a stop and, once a watch reads degraded, the interval.
   * Starts no read and no process.
   */
  wait: (input: TickWaitInput) => Promise<void>;
}

/**
 * Builds the supervision tick's wait.
 *
 * The deadline timer counts monotonic time through the `Clock` port. A wake
 * after sleep fires it late and `clockDrift` reads the jump, which triggers the
 * tick as well. Where the clock does not answer, the deadline timer waits
 * `intervalMs`, so a clock that keeps failing cannot end every wait at once.
 *
 * @param clock - the timer and the wall clock; a manual clock in tests.
 * @param sleep - waits `ms`; the degraded cadence.
 * @returns the wait.
 */
export const tickWake = (clock: Clock, sleep: (ms: number) => Promise<void>): TickWake => {
  let triggered = false;
  let wakeNow: (() => void) | null = null;
  let recheckNow: (() => void) | null = null;
  const trigger = (): void => {
    triggered = true;
    wakeNow?.();
  };
  return {
    trigger,
    clear: () => {
      triggered = false;
    },
    recheck: () => recheckNow?.(),
    wait: async ({ deadlineAt, degraded, intervalMs, requested }) => {
      if (triggered) return;
      const cancels: (() => void)[] = [];
      let finished = false;
      let sleeping = false;
      const ended = new Promise<void>((resolve) => {
        const end = (): void => {
          finished = true;
          resolve();
        };
        wakeNow = end;
        const check = (): void => {
          if (finished || sleeping || !degraded()) return;
          sleeping = true;
          void sleep(intervalMs).then(() => { if (!finished) end(); });
        };
        recheckNow = check;
        if (deadlineAt !== null) {
          const now = clock.now();
          const delay = now.ok ? Math.max(0, deadlineAt - now.value) : intervalMs;
          cancels.push(clock.timeout(delay, end));
        }
        check();
        void requested.then(end);
      });
      try {
        await ended;
      } finally {
        wakeNow = null;
        recheckNow = null;
        for (const cancel of cancels) cancel();
      }
    },
  };
};
