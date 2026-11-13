import type { Clock } from '@plot-pm/domain/ports/clock';
import type { SnapshotChange } from '@plot-pm/domain';

/** What the wait reads each time it starts. */
export interface TickWaitInput {
  /** The earliest wall time a deadline the tick owns can change its answer, epoch milliseconds; `null` holds none. */
  deadlineAt: number | null;
  /** Whether a watch is degraded or absent: the wait then also ends after `intervalMs`. */
  degraded: boolean;
  /** The `--interval` cadence, milliseconds, used only while `degraded`. */
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
  /**
   * Waits for the first of a trigger, the deadline, a stop and, while a watch is degraded, the interval.
   * Starts no read and no process.
   */
  wait: (input: TickWaitInput) => Promise<void>;
}

/** The changes that start a supervision tick: a registry, a desk's files or a worker's end. */
export const startsTick = (change: SnapshotChange): boolean =>
  change.kind === 'registry' || change.kind === 'desk-files' || change.kind === 'worker-gone';

/**
 * Builds the supervision tick's wait.
 *
 * The deadline timer counts monotonic time through the `Clock` port. A wake
 * after sleep fires it late and `clockDrift` reads the jump, which triggers the
 * tick as well.
 *
 * @param clock - the timer and the wall clock; a manual clock in tests.
 * @param sleep - waits `ms`; the degraded cadence.
 * @returns the wait.
 */
export const tickWake = (clock: Clock, sleep: (ms: number) => Promise<void>): TickWake => {
  let triggered = false;
  let wakeNow: (() => void) | null = null;
  const trigger = (): void => {
    triggered = true;
    wakeNow?.();
  };
  return {
    trigger,
    clear: () => {
      triggered = false;
    },
    wait: async ({ deadlineAt, degraded, intervalMs, requested }) => {
      if (triggered) return;
      const cancels: (() => void)[] = [];
      let finished = false;
      const ended = new Promise<void>((resolve) => {
        const end = (): void => {
          finished = true;
          resolve();
        };
        wakeNow = end;
        if (deadlineAt !== null) {
          const now = clock.now();
          const delay = now.ok ? Math.max(0, deadlineAt - now.value) : 0;
          cancels.push(clock.timeout(delay, end));
        }
        if (degraded) void sleep(intervalMs).then(() => { if (!finished) end(); });
        void requested.then(end);
      });
      try {
        await ended;
      } finally {
        wakeNow = null;
        for (const cancel of cancels) cancel();
      }
    },
  };
};
