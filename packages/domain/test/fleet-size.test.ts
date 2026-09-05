import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FLEET_SIZE,
  fleetSize,
  headroomFor,
  HEADROOM_THRESHOLDS,
  type FleetSizeReadings,
} from '../src/index.js';

/**
 * `fleetSize` — how many agents a start brings up, and why it is ever fewer.
 *
 * NO MACHINE AND NO PROCESS TABLE. The spawn cost arrives as a value the caller
 * sampled, so every band the rule judges is reachable from a plain record —
 * including `starved`, which on a real machine costs 28.7 s of forking to
 * produce and cannot be asked for on demand.
 *
 * The rule owns three answers and nothing else: subtract what is running,
 * bound by what the machine can bear, and say what was dropped. Nothing here
 * remembers a shortfall, which is the property the daemon's statelessness rests
 * on — see the last describe block.
 */

/**
 * A reading, with the headroom DERIVED from the cost unless overridden.
 *
 * The two arrive as separate fields because the rule takes the verdict rather
 * than computing it; a fixture that let them disagree by accident would test a
 * machine that cannot exist, so the helper keeps them in step and a test that
 * wants them apart says so.
 */
const readings = (over: Partial<FleetSizeReadings> = {}): FleetSizeReadings => {
  const spawnCostMs = over.spawnCostMs === undefined ? 1 : over.spawnCostMs;
  return {
    requested: DEFAULT_FLEET_SIZE,
    running: 0,
    spawnCostMs,
    headroom: headroomFor(spawnCostMs),
    ...over,
  };
};

/** A cost inside each band, taken from the thresholds rather than guessed. */
const CLEAR = HEADROOM_THRESHOLDS.clearBelowMs - 1;
const TIGHT = HEADROOM_THRESHOLDS.clearBelowMs + 1;
const STARVED = HEADROOM_THRESHOLDS.starvedAboveMs + 1;

describe('fleetSize — the request, and what is already running', () => {
  it('starts the default three on a clear machine with nothing running', () => {
    const answer = fleetSize(readings({ spawnCostMs: CLEAR }));
    expect(answer.start).toBe(3);
    expect(answer.shortfall).toBe('');
  });

  it('asks for a fleet OF N, not N more — running twice does not double it', () => {
    // The whole reason the subtraction comes first: an operator who has lost
    // track asks for the size they want.
    const first = fleetSize(readings({ requested: 3, running: 0, spawnCostMs: CLEAR }));
    const second = fleetSize(readings({ requested: 3, running: first.start, spawnCostMs: CLEAR }));
    expect(first.start).toBe(3);
    expect(second.start).toBe(0);
  });

  it('says why it started nothing when the fleet is already the size asked for', () => {
    const answer = fleetSize(readings({ requested: 3, running: 3, spawnCostMs: CLEAR }));
    expect(answer.start).toBe(0);
    expect(answer.shortfall).toContain('already running');
  });

  it('starts the difference when part of the fleet is already up', () => {
    expect(fleetSize(readings({ requested: 3, running: 1, spawnCostMs: CLEAR })).start).toBe(2);
  });

  it('starts nothing for a request of zero, and calls it no shortfall', () => {
    const answer = fleetSize(readings({ requested: 0, spawnCostMs: CLEAR }));
    expect(answer.start).toBe(0);
    expect(answer.shortfall).toBe('');
  });

  it('reads a negative request as zero rather than as a subtraction', () => {
    expect(fleetSize(readings({ requested: -2, spawnCostMs: CLEAR })).start).toBe(0);
  });
});

describe('fleetSize — the machine has the last word', () => {
  it('does not bound a clear machine', () => {
    const answer = fleetSize(readings({ requested: 8, spawnCostMs: CLEAR }));
    expect(answer.start).toBe(8);
    expect(answer.headroom).toBe('clear');
  });

  it('gives a tight machine fewer than asked for, and says so', () => {
    const answer = fleetSize(readings({ requested: 5, spawnCostMs: TIGHT }));
    expect(answer.headroom).toBe('tight');
    expect(answer.start).toBeLessThan(5);
    expect(answer.shortfall).toContain('the machine is at its bound');
  });

  it('still starts ONE on a starved machine rather than refusing', () => {
    // A starved machine that starts nothing is a fleet that cannot recover on
    // its own: the load comes from work already running.
    const answer = fleetSize(readings({ requested: 3, spawnCostMs: STARVED }));
    expect(answer.headroom).toBe('starved');
    expect(answer.start).toBe(1);
  });

  it('names the reading in the shortfall, so nobody reads it as the request met', () => {
    const answer = fleetSize(readings({ requested: 3, spawnCostMs: STARVED }));
    expect(answer.shortfall).toContain('starved');
    expect(answer.shortfall).toContain(`${Math.round(STARVED)}ms`);
  });

  it('treats an unmeasured machine as clear — an absent veto is not a refusal', () => {
    const answer = fleetSize(readings({ requested: 4, spawnCostMs: null }));
    expect(answer.headroom).toBe('unmeasured');
    expect(answer.start).toBe(4);
    expect(answer.shortfall).toBe('');
  });

  it('never starts more than asked for, however clear the machine', () => {
    expect(fleetSize(readings({ requested: 1, spawnCostMs: CLEAR })).start).toBe(1);
  });

  it('takes the headroom as given rather than re-deriving it from the cost', () => {
    // THE READING IS THE CALLER'S, and this is what says so mechanically: a
    // starved verdict over a clear cost bounds the start, because the rule
    // holds no copy of the thresholds to disagree with.
    const answer = fleetSize({
      requested: 3,
      running: 0,
      spawnCostMs: CLEAR,
      headroom: 'starved',
    });
    expect(answer.start).toBe(1);
  });
});

describe('fleetSize — the shortfall is reported and not remembered', () => {
  it('is a function of its readings alone: the same input gives the same answer', () => {
    // THE PROPERTY THE DAEMON'S STATELESSNESS RESTS ON. A start that gave one
    // of three leaves nothing behind, so the next call re-derives everything
    // this one did rather than resuming a target.
    const input = readings({ requested: 3, spawnCostMs: STARVED });
    expect(fleetSize(input)).toEqual(fleetSize(input));
  });

  it('carries no field naming what it still owes', () => {
    const answer = fleetSize(readings({ requested: 3, spawnCostMs: STARVED }));
    expect(Object.keys(answer).sort()).toEqual(
      ['headroom', 'requested', 'running', 'shortfall', 'start'].sort(),
    );
  });
});
