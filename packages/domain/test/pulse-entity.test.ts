import { describe, it, expect } from 'vitest';

import { clockFixed, clockManual } from '../src/adapters/clock/clock-system.js';
import {
  addSubscriber,
  beat,
  createPulse,
  divisorFor,
  dueSubscribers,
  isDue,
  removeSubscriber,
  startPulse,
  type Subscriber,
} from '../src/entities/pulse.js';

/**
 * THE CLOCK, COUNTED RATHER THAN WAITED FOR.
 *
 * Nothing here sleeps. That is the whole reason `schedule` is a port: twelve
 * real beats at the 5 s base is a minute of waiting per assertion, and the
 * property under test — a divisor — is arithmetic on a count.
 *
 * `pulse-entity.test.ts` rather than `pulse.test.ts`, which is taken by
 * `rules/pulse.ts` — the fleet scan's READING of the estate. Two unrelated
 * concepts once shared the word `Pulse`; `the-scan-reads-a-fleet-reading`
 * settled it, and the file names keep the settlement visible.
 */

/** A subscriber that counts its own runs, so a cadence is a number. */
const counting = (name: string, everyNthBeat: number) => {
  const runs: number[] = [];
  const subscriber: Subscriber = { name, everyNthBeat, tick: () => void runs.push(runs.length) };
  return { subscriber, count: () => runs.length };
};

describe('a subscriber names a divisor', () => {
  it('runs every beat at divisor 1', () => {
    // THE SCAN'S CADENCE. Git is local and free, so it takes every beat.
    const scan = counting('scan', 1);
    let pulse = addSubscriber(createPulse(5_000, 0), scan.subscriber);
    for (let n = 0; n < 12; n += 1) pulse = beat(pulse).pulse;
    expect(scan.count()).toBe(12);
  });

  it('runs once in twelve beats at divisor 12', () => {
    // THE PR READER'S CADENCE, and the number the host outage bought: firing it
    // on the 5 s timer spent a 5000/hour budget in a working day.
    const reader = counting('pr-reader', 12);
    let pulse = addSubscriber(createPulse(5_000, 0), reader.subscriber);
    // 13 beats, not 12: beats 0 and 12 are both its turn, which is what makes
    // the count 2 and proves the modulo rather than a decrementing counter.
    for (let n = 0; n < 13; n += 1) pulse = beat(pulse).pulse;
    expect(reader.count()).toBe(2);
  });

  it('runs both at their own cadence off one clock', () => {
    // THE SLICE'S FIRST HALF: two subscribers, one schedule, the effective
    // cadences unchanged. 5 s and 60 s, expressed as 1 and 12.
    const scan = counting('scan', 1);
    const reader = counting('pr-reader', 12);
    let pulse = addSubscriber(addSubscriber(createPulse(5_000, 0), scan.subscriber), reader.subscriber);
    for (let n = 0; n < 24; n += 1) pulse = beat(pulse).pulse;
    expect(scan.count()).toBe(24);
    expect(reader.count()).toBe(2);
  });

  it('treats beat zero as every subscriber’s turn', () => {
    // The board already relies on this: both sources are warmed at startup so
    // the first person to open the tab does not wait a minute for PR data.
    const pulse = addSubscriber(createPulse(5_000, 0), counting('pr-reader', 12).subscriber);
    expect(dueSubscribers(pulse).map((s) => s.name)).toEqual(['pr-reader']);
  });

  it('reads a divisor off a beat count without a pulse', () => {
    expect(isDue({ name: 'a', everyNthBeat: 6, tick: () => undefined }, 6)).toBe(true);
    expect(isDue({ name: 'a', everyNthBeat: 6, tick: () => undefined }, 7)).toBe(false);
  });
});

describe('the divisors are derived, not configured', () => {
  it('reads 12 off a 60 s period and a 5 s base', () => {
    // 12 is right ONLY because the base is 5 s. A caller asks for its divisor
    // rather than writing one down, so moving the base moves every cadence.
    expect(divisorFor(createPulse(5_000, 0), 60_000)).toBe(12);
    expect(divisorFor(createPulse(5_000, 0), 5_000)).toBe(1);
    expect(divisorFor(createPulse(5_000, 0), 30_000)).toBe(6);
  });

  it('moves every divisor when the base moves', () => {
    // THE PROPERTY THE MODEL EXISTS FOR. The ratios are the design; the base is
    // one session's guess. At a 10 s base the PR reader waits 6 beats and its
    // effective cadence is still 60 s.
    const slower = createPulse(10_000, 0);
    expect(divisorFor(slower, 60_000)).toBe(6);
    expect(divisorFor(slower, 60_000) * slower.intervalMs).toBe(60_000);
  });

  it('answers 1 for a period shorter than the base', () => {
    // A clock that beats at 5 s cannot honour 2 s. Every beat is the closest
    // cadence that exists, and it is not a division by zero.
    expect(divisorFor(createPulse(5_000, 0), 2_000)).toBe(1);
    expect(divisorFor(createPulse(5_000, 0), 0)).toBe(1);
  });
});

describe('a failing subscriber cannot delay another’s beat', () => {
  it('keeps a neighbour’s cadence when one throws on every beat', () => {
    // THE ASSERTION THAT IS THE SLICE, first half. The two timers were SPLIT
    // because a metered host and a local git fail differently; a shared clock
    // that re-couples them is worse than today.
    const scan = counting('scan', 1);
    const throwing: Subscriber = {
      name: 'throws',
      everyNthBeat: 1,
      tick: () => {
        throw new Error('the host refused');
      },
    };
    // FIRST in the list, so a beat that stopped at the throw would leave the
    // scan at zero rather than merely one short.
    let pulse = addSubscriber(addSubscriber(createPulse(5_000, 0), throwing), scan.subscriber);
    for (let n = 0; n < 12; n += 1) pulse = beat(pulse).pulse;
    expect(scan.count()).toBe(12);
  });

  it('keeps a neighbour’s cadence when one never returns', () => {
    // THE ASSERTION THAT IS THE SLICE, second half. A hang is the failure a
    // rate-limited host actually produces, and it is the one an `await` in the
    // beat would convert into a stopped clock for everybody.
    const scan = counting('scan', 1);
    let entered = 0;
    const hanging: Subscriber = {
      name: 'hangs',
      everyNthBeat: 1,
      tick: () => {
        entered += 1;
        // Never settles. No timer, so nothing here has to be cleaned up.
        return new Promise<void>(() => undefined);
      },
    };
    let pulse = addSubscriber(addSubscriber(createPulse(5_000, 0), hanging), scan.subscriber);
    for (let n = 0; n < 12; n += 1) pulse = beat(pulse).pulse;
    expect(scan.count()).toBe(12);
    // And it was entered every beat rather than skipped: the pulse does not
    // track whether a subscriber is still running. Re-entrancy is the
    // subscriber's own concern, guarded today by `running` and `prRunning`.
    expect(entered).toBe(12);
  });

  it('raises the count on a beat where every subscriber threw', () => {
    // A subscriber with a bug is not a stopped clock.
    const throwing: Subscriber = {
      name: 'throws',
      everyNthBeat: 1,
      tick: () => {
        throw new Error('no');
      },
    };
    const pulse = addSubscriber(createPulse(5_000, 0), throwing);
    expect(beat(pulse).pulse.beatCount).toBe(1);
  });

  it('reports which subscriber threw, and with what', () => {
    // The beat REPORTS rather than reacts: there is no retry here, because the
    // next beat is the retry and it is already scheduled.
    const boom = new Error('the host refused');
    let pulse = addSubscriber(createPulse(5_000, 0), {
      name: 'throws',
      everyNthBeat: 1,
      tick: () => {
        throw boom;
      },
    });
    pulse = addSubscriber(pulse, counting('scan', 1).subscriber);
    expect(beat(pulse).ran).toEqual([
      { name: 'throws', error: boom },
      { name: 'scan', error: null },
    ]);
  });

  it('does not let an async rejection escape the beat', async () => {
    // An unhandled rejection kills the process on Node's default settings, so
    // "detached" has to mean "detached and caught" — a subscriber whose promise
    // rejects is a subscriber with a bug, not a dead board.
    const scan = counting('scan', 1);
    let pulse = addSubscriber(createPulse(5_000, 0), {
      name: 'rejects',
      everyNthBeat: 1,
      tick: () => Promise.reject(new Error('the host refused')),
    });
    pulse = addSubscriber(pulse, scan.subscriber);
    const beaten = beat(pulse);
    // The rejection is reported as no error, because it had not happened yet
    // when the beat returned. That is the isolation, not an omission.
    expect(beaten.ran).toEqual([
      { name: 'rejects', error: null },
      { name: 'scan', error: null },
    ]);
    // Let the microtask queue drain. Nothing throws here; if the `.catch` were
    // missing this test would fail the process rather than the assertion.
    await Promise.resolve();
    await Promise.resolve();
    expect(scan.count()).toBe(1);
  });
});

describe('beatCount only rises, and nothing is owed', () => {
  it('makes a late subscriber wait for its next multiple', () => {
    // A subscriber joining at beat 400 with divisor 6 waits until 402. Not run
    // now, and not run six times to catch up: replaying a clock's missed beats
    // replays questions whose answers have already changed.
    let pulse = createPulse(5_000, 0);
    for (let n = 0; n < 400; n += 1) pulse = beat(pulse).pulse;
    const late = counting('late', 6);
    pulse = addSubscriber(pulse, late.subscriber);
    expect(pulse.beatCount).toBe(400);
    expect(late.count()).toBe(0);
    // 401 — not its turn. 402 — 402 % 6 === 0.
    pulse = beat(pulse).pulse;
    expect(late.count()).toBe(0);
    pulse = beat(pulse).pulse;
    expect(late.count()).toBe(0);
    pulse = beat(pulse).pulse;
    expect(late.count()).toBe(1);
  });

  it('never runs a subscriber on subscription', () => {
    // The cost of a new subscriber is bounded by the divisor it declared. With
    // catch-up, subscribing would run an 18.3 s scan at an unpredictable moment.
    const scan = counting('scan', 1);
    const pulse = addSubscriber(createPulse(5_000, 0), scan.subscriber);
    expect(scan.count()).toBe(0);
    expect(pulse.beatCount).toBe(0);
  });

  it('starts a restarted clock at zero', () => {
    // Not persisted. A restart re-derives everything, and nothing is owed for
    // the beats that did not happen.
    expect(createPulse(5_000, 1_756_000_000_000).beatCount).toBe(0);
  });
});

describe('a divisor is a whole number of beats', () => {
  it('clamps a fractional divisor down to a whole beat', () => {
    // 1.5 beats is a cadence no clock has. Floored rather than stored, so it
    // fires at a cadence that exists.
    const pulse = addSubscriber(createPulse(5_000, 0), {
      name: 'fractional',
      everyNthBeat: 2.9,
      tick: () => undefined,
    });
    expect(pulse.subscribers[0].everyNthBeat).toBe(2);
  });

  it('clamps zero and negatives to every beat', () => {
    // `0` would make every `beatCount % 0` a NaN and the subscriber would never
    // fire — a poller that silently stopped, which is the failure this clamp
    // exists to prevent.
    const zero = counting('zero', 0);
    let pulse = addSubscriber(createPulse(5_000, 0), zero.subscriber);
    pulse = addSubscriber(pulse, { name: 'negative', everyNthBeat: -6, tick: () => undefined });
    expect(pulse.subscribers.map((s) => s.everyNthBeat)).toEqual([1, 1]);
    pulse = beat(pulse).pulse;
    expect(zero.count()).toBe(1);
  });
});

describe('a subscriber leaves', () => {
  it('stops ticking a removed subscriber and keeps the rest', () => {
    const scan = counting('scan', 1);
    const reader = counting('pr-reader', 1);
    let pulse = addSubscriber(addSubscriber(createPulse(5_000, 0), scan.subscriber), reader.subscriber);
    pulse = beat(pulse).pulse;
    pulse = removeSubscriber(pulse, 'pr-reader');
    pulse = beat(pulse).pulse;
    expect(scan.count()).toBe(2);
    expect(reader.count()).toBe(1);
  });

  it('removes nothing for a name nobody holds', () => {
    // Not an error: there is no state to be wrong about.
    const pulse = addSubscriber(createPulse(5_000, 0), counting('scan', 1).subscriber);
    expect(removeSubscriber(pulse, 'nobody').subscribers).toHaveLength(1);
  });
});

describe('a running pulse holds one schedule', () => {
  it('makes exactly one schedule for any number of subscribers', () => {
    // ONE clock, not one timer per subscriber. Three schedules wearing one
    // entity's name would be the three timers back.
    const clock = clockManual(1_000);
    const running = startPulse(clock, 5_000);
    running.add(counting('scan', 1).subscriber);
    running.add(counting('pr-reader', 12).subscriber);
    expect(clock.scheduled()).toBe(1);
    running.stop();
  });

  it('drives both cadences off that one schedule', () => {
    // THE SLICE, through the port: the scan every beat, the PR reader every
    // twelfth, twelve beats advanced without a millisecond of waiting.
    const clock = clockManual(1_000);
    const running = startPulse(clock, 5_000);
    const scan = counting('scan', 1);
    const reader = counting('pr-reader', divisorFor(running.reading(), 60_000));
    running.add(scan.subscriber);
    running.add(reader.subscriber);
    clock.advance(24);
    expect(scan.count()).toBe(24);
    // Beat 0 was before either subscribed, so the reader's turns are 12 and 24.
    expect(reader.count()).toBe(2);
    running.stop();
  });

  it('stops beating when stopped, and stopping twice is not an error', () => {
    const clock = clockManual(1_000);
    const running = startPulse(clock, 5_000);
    const scan = counting('scan', 1);
    running.add(scan.subscriber);
    clock.advance(3);
    running.stop();
    running.stop();
    clock.advance(10);
    expect(scan.count()).toBe(3);
    expect(clock.scheduled()).toBe(0);
  });

  it('reports the clock it started on', () => {
    const clock = clockManual(1_756_000_000_000);
    const running = startPulse(clock, 5_000);
    expect(running.reading()).toMatchObject({
      intervalMs: 5_000,
      beatCount: 0,
      startedAt: 1_756_000_000_000,
      subscribers: [],
    });
    clock.advance(4);
    expect(running.reading().beatCount).toBe(4);
    running.stop();
  });

  it('beats from zero when the clock cannot say what time it is', () => {
    // `startedAt` is a report, not an operand. An unanswerable `now` is not a
    // reason to refuse to beat — every divisor reads `beatCount`.
    const scan = counting('scan', 1);
    let onTick = () => undefined as void;
    const mute = {
      now: () => ({ ok: false, why: 'failed' }) as const,
      timezoneOffsetMinutes: () => ({ ok: false, why: 'failed' }) as const,
      schedule: (_ms: number, fn: () => void) => {
        onTick = fn;
        return () => undefined;
      },
    };
    const running = startPulse(mute, 5_000);
    running.add(scan.subscriber);
    expect(running.reading().startedAt).toBe(0);
    onTick();
    expect(scan.count()).toBe(1);
    expect(running.reading().beatCount).toBe(1);
  });

  it('reports each beat to an observer', () => {
    const clock = clockManual(1_000);
    const seen: number[] = [];
    const running = startPulse(clock, 5_000, (b) => void seen.push(b.pulse.beatCount));
    running.add(counting('scan', 1).subscriber);
    clock.advance(3);
    // The count reported is the one AFTER the beat, so a reader logging it sees
    // a number that only rises.
    expect(seen).toEqual([1, 2, 3]);
    running.stop();
  });

  it('keeps counting when the observer throws', () => {
    // A logger's failure is not the clock's — the same isolation the
    // subscribers get, applied to whoever watches them.
    const clock = clockManual(1_000);
    const scan = counting('scan', 1);
    const running = startPulse(clock, 5_000, () => {
      throw new Error('the log is full');
    });
    running.add(scan.subscriber);
    clock.advance(5);
    expect(scan.count()).toBe(5);
    expect(running.reading().beatCount).toBe(5);
    running.stop();
  });

  it('lets a subscriber leave a running clock', () => {
    const clock = clockManual(1_000);
    const scan = counting('scan', 1);
    const reader = counting('pr-reader', 1);
    const running = startPulse(clock, 5_000);
    running.add(scan.subscriber);
    running.add(reader.subscriber);
    clock.advance(2);
    running.remove('pr-reader');
    clock.advance(2);
    expect(scan.count()).toBe(4);
    expect(reader.count()).toBe(2);
    running.stop();
  });
});

describe('a fixed clock cannot beat', () => {
  it('accepts a schedule and never fires it', () => {
    // A time that never advances never reaches the next interval. Accepted
    // rather than refused, so the staleness rules `clockFixed` exists for do
    // not have to hold a second clock.
    const scan = counting('scan', 1);
    const running = startPulse(clockFixed(1_000), 5_000);
    running.add(scan.subscriber);
    expect(scan.count()).toBe(0);
    expect(running.reading().beatCount).toBe(0);
    running.stop();
  });
});
