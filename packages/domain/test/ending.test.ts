import { describe, it, expect } from 'vitest';
import {
  ENDING_FILENAME,
  EndingActorSchema,
  EndingReasonSchema,
  EndingSchema,
  endedOnAReading,
  endedSpent,
  readEnding,
} from '../src/index.js';

/**
 * The record `_ended_detail` never had.
 *
 * `plot-worker-loop.sh` set it at three points and wrote it nowhere — no file,
 * no stdout — so the distinction it drew lived for one stderr line and reached
 * no reader that outlived the process. The assertion the plan makes is the one
 * this file exists to hold: **a bound expiry and a context exhaustion are
 * different endings**, because today they are the same one.
 */

/** An ending as JSON, with any field overridden — INCLUDING an invalid one. */
const ended = (over: Record<string, unknown> = {}) => JSON.stringify({
  reason: 'bound',
  actor: 'bound',
  branch: 'feature/x',
  detail: 'exceeded the 28800s bound',
  ...over,
});

describe('the ending sits beside the exit code', () => {
  it('joins the family the desk already uses', () => {
    expect(ENDING_FILENAME).toBe('.plot-worker.ending.json');
  });

  it('is one per worker, so its filename does not name a branch', () => {
    // A declaration is per BRANCH because a worker hops. An ending happens once
    // to the worker, and the branch is a field rather than the subject.
    expect(ENDING_FILENAME).not.toContain('{');
  });
});

describe('a bound expiry and a context exhaustion are different endings', () => {
  it('reads the five reasons apart', () => {
    expect(EndingReasonSchema.options).toEqual(['bound', 'quiet', 'unreadable', 'spent', 'unstarted']);
  });

  it('does not collapse spent into bound', () => {
    const clock = readEnding(ended({ reason: 'bound' }));
    const context = readEnding(ended({ reason: 'spent', actor: 'monitor' }));

    expect(clock.read).toBe('ended');
    expect(context.read).toBe('ended');
    // The whole point of the record: these two were indistinguishable before it.
    expect(clock).not.toEqual(context);
    expect(endedSpent(context)).toBe(true);
    expect(endedSpent(clock)).toBe(false);
  });

  it('keeps unreadable apart from bound, though both are the floor firing', () => {
    // They differ in what was known WHILE the worker ran, not in what stopped
    // it. Collapsing them claims a measurement came back empty when Plot never
    // had the reading.
    const floor = readEnding(ended({ reason: 'bound' }));
    const blind = readEnding(ended({ reason: 'unreadable' }));

    expect(floor).not.toEqual(blind);
    expect(endedOnAReading(floor)).toBe(false);
    expect(endedOnAReading(blind)).toBe(false);
  });

  it('separates a finding from a clock', () => {
    expect(endedOnAReading(readEnding(ended({ reason: 'quiet', actor: 'monitor' })))).toBe(true);
    expect(endedOnAReading(readEnding(ended({ reason: 'spent', actor: 'monitor' })))).toBe(true);
    expect(endedOnAReading(readEnding(ended({ reason: 'bound' })))).toBe(false);
    expect(endedOnAReading(readEnding(ended({ reason: 'unreadable' })))).toBe(false);
    // An exit code is a fact about a command, not a measurement of an agent —
    // and no slice ran for anything to be read about.
    expect(endedOnAReading(readEnding(ended({ reason: 'unstarted', actor: 'agent' })))).toBe(false);
  });

  it('keeps a prompt that never ran apart from every ending a watcher produced', () => {
    // The other four are the floor firing or the monitor publishing. This one
    // is the agent's own process reporting its command's exit code, which is
    // why its actor is `agent` — `EndingActorSchema`'s only unwritten value
    // until 2026-09-05, when three agents were refused
    // `Session ID … is already in use` and each sub-second exit read as a
    // completed slice.
    const unstarted = readEnding(ended({
      reason: 'unstarted',
      actor: 'agent',
      detail: 'the worker prompt exited 1 without running, on 3 attempts',
    }));

    expect(unstarted.read).toBe('ended');
    expect(unstarted).not.toEqual(readEnding(ended({ reason: 'bound' })));
    expect(unstarted).not.toEqual(readEnding(ended({ reason: 'quiet', actor: 'monitor' })));
    expect(unstarted).not.toEqual(readEnding(ended({ reason: 'unreadable' })));
    expect(endedSpent(unstarted)).toBe(false);
    // `detail` carries the whole diagnosis, which is why no actor names the
    // runtime.
    expect(unstarted.read === 'ended' && unstarted.ending.detail).toContain('without running');
  });

  it('refuses a reason nobody defined', () => {
    expect(readEnding(ended({ reason: 'crashed' })).read).toBe('unreadable');
  });
});

describe('the actor is carried with the reason, and does not follow from it', () => {
  it('reads the three actors', () => {
    expect(EndingActorSchema.options).toEqual(['bound', 'monitor', 'agent']);
  });

  it('parses an ending that attributes itself to the agent, and judges it elsewhere', () => {
    // `agent` was admitted here from the start, written by nobody, and removed
    // on 2026-09-04 on that measurement. The `unstarted` writer arrived the
    // next day and it is back — for that reason ONLY, which is the pair
    // `endingIsAttributable` reads.
    //
    // THE PARSE DECIDES SHAPE AND THE TRANSITION DECIDES ATTRIBUTION, which is
    // the division this file already draws for `reason` and `actor` not
    // determining each other. `{ reason: 'bound', actor: 'agent' }` is a
    // well-formed record making a claim nothing may act on, and reporting it
    // `unreadable` would say the bytes were bad when what is wrong is what they
    // assert.
    expect(readEnding(ended({ reason: 'bound', actor: 'agent' })).read).toBe('ended');
    expect(readEnding(ended({ reason: 'unstarted', actor: 'agent' })).read).toBe('ended');
  });

  it('lets one actor end a worker for more than one reason', () => {
    // The floor ends a worker for `bound` and for `unreadable` alike.
    const first = readEnding(ended({ reason: 'bound', actor: 'bound' }));
    const second = readEnding(ended({ reason: 'unreadable', actor: 'bound' }));

    expect(first.read === 'ended' && first.ending.actor).toBe('bound');
    expect(second.read === 'ended' && second.ending.actor).toBe('bound');
    expect(first.read === 'ended' && first.ending.reason).not.toBe(
      second.read === 'ended' ? second.ending.reason : null,
    );
  });

  it('refuses an actor nobody defined', () => {
    expect(readEnding(ended({ actor: 'kernel' })).read).toBe('unreadable');
  });
});

describe('absence is not unreadability', () => {
  it('reads no file as absent', () => {
    // A SIGKILLed worker never reaches the write, and one that predates this
    // record never had it. Nobody measured anything.
    expect(readEnding(null)).toEqual({ read: 'absent' });
  });

  it('reads a file that exists and holds nothing as unreadable', () => {
    const reading = readEnding('');
    expect(reading.read).toBe('unreadable');
  });

  it('reads bytes that are not JSON as unreadable, naming why', () => {
    const reading = readEnding('{ half-written');
    expect(reading).toEqual({ read: 'unreadable', why: 'not JSON' });
  });

  it('does not report an unreadable file as absent', () => {
    // Reporting it as absent would claim nothing was written.
    expect(readEnding('{ half-written').read).not.toBe('absent');
    expect(readEnding(ended({ reason: 'nonsense' })).read).not.toBe('absent');
  });

  it('answers neither verdict for an ending it could not read', () => {
    // *Cannot answer* is not *no* — but it is not *yes* either.
    for (const text of [null, '', '{ half-written']) {
      expect(endedOnAReading(readEnding(text))).toBe(false);
      expect(endedSpent(readEnding(text))).toBe(false);
    }
  });
});

describe('what a worker knew at the time', () => {
  it('keeps the branch it held and the sentence naming the reading', () => {
    const reading = readEnding(ended({ reason: 'quiet', actor: 'monitor', detail: 'the WorkerMonitor reported idle' }));

    expect(reading).toEqual({
      read: 'ended',
      ending: {
        reason: 'quiet',
        actor: 'monitor',
        branch: 'feature/x',
        detail: 'the WorkerMonitor reported idle',
      },
    });
  });

  it('defaults branch and detail to empty rather than refusing', () => {
    // A worker that ended before it claimed anything holds no branch, and that
    // is an absence rather than a malformed record.
    const reading = readEnding(JSON.stringify({ reason: 'bound', actor: 'bound' }));

    expect(reading).toEqual({
      read: 'ended',
      ending: { reason: 'bound', actor: 'bound', branch: '', detail: '' },
    });
  });

  it('refuses a record naming no reason, and one naming no actor', () => {
    expect(readEnding(JSON.stringify({ actor: 'bound' })).read).toBe('unreadable');
    expect(readEnding(JSON.stringify({ reason: 'bound' })).read).toBe('unreadable');
  });

  it('drops a key it does not know rather than refusing the record', () => {
    // A newer worker writing a field this parse does not know has not written a
    // broken record.
    const reading = readEnding(ended({ machineAtDeath: 'laptop-1' }));

    expect(reading.read).toBe('ended');
    expect(reading.read === 'ended' && reading.ending).not.toHaveProperty('machineAtDeath');
  });

  it('parses the schema directly to the same shape', () => {
    expect(EndingSchema.parse({ reason: 'spent', actor: 'monitor' })).toEqual({
      reason: 'spent',
      actor: 'monitor',
      branch: '',
      detail: '',
    });
  });
});
