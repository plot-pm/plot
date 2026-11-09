import { describe, expect, it } from 'vitest';

import {
  withLivenessBasis,
  workerLiveness,
  type TokenReading,
  type WorkerLivenessReadings,
} from '../src/rules/worker-liveness.js';

const MADE = 1_000_000;
const BOUND = 28_800_000;
const held: TokenReading = { state: 'held', madeAtMs: MADE };
const released: TokenReading = { state: 'released', madeAtMs: MADE };

const desk = (over: Partial<WorkerLivenessReadings> = {}): WorkerLivenessReadings => ({
  exitAtMs: null,
  token: held,
  pidAnswers: true,
  startedAtMs: MADE,
  nowMs: MADE + 60_000,
  workerBoundMs: BOUND,
  ...over,
});

describe('workerLiveness', () => {
  it('answers the start-time basis for a desk with no token', () => {
    expect(workerLiveness(desk({ token: { state: 'none', madeAtMs: null } }))).toEqual({ basis: 'start-time' });
    expect(workerLiveness(desk({ token: { state: 'held', madeAtMs: null } }))).toEqual({ basis: 'start-time' });
  });

  it('lets an exit record not older than the token win over a held token', () => {
    expect(workerLiveness(desk({ exitAtMs: MADE }))).toEqual({ basis: 'token', liveness: 'exited', exitCurrent: true });
    expect(workerLiveness(desk({ exitAtMs: MADE + 5 }))).toMatchObject({ liveness: 'exited' });
  });

  it('ignores an exit record older than the token', () => {
    expect(workerLiveness(desk({ exitAtMs: MADE - 1 }))).toEqual({ basis: 'token', liveness: 'live', exitCurrent: false });
  });

  it('reads a held token with an answering pid within the bound as live', () => {
    expect(workerLiveness(desk())).toMatchObject({ liveness: 'live' });
  });

  it('reads a held token whose pid does not answer as a stray holder', () => {
    expect(workerLiveness(desk({ pidAnswers: false }))).toMatchObject({ liveness: 'stray-holder' });
  });

  it('reads a released token with no current exit record as dead', () => {
    expect(workerLiveness(desk({ token: released }))).toEqual({ basis: 'token', liveness: 'dead', exitCurrent: false });
    expect(workerLiveness(desk({ token: released, exitAtMs: MADE - 1 }))).toMatchObject({ liveness: 'dead' });
  });

  it('never reads live past Worker bound, and a stray holder past it reads dead', () => {
    const past = { nowMs: MADE + BOUND };
    expect(workerLiveness(desk(past))).toMatchObject({ liveness: 'dead' });
    expect(workerLiveness(desk({ ...past, pidAnswers: false }))).toMatchObject({ liveness: 'dead' });
  });

  it('sets no ceiling with a bound of 0 or no recorded start', () => {
    expect(workerLiveness(desk({ nowMs: MADE + 10 * BOUND, workerBoundMs: 0 }))).toMatchObject({ liveness: 'live' });
    expect(workerLiveness(desk({ nowMs: MADE + 10 * BOUND, startedAtMs: null }))).toMatchObject({ liveness: 'live' });
  });
});

describe('withLivenessBasis', () => {
  it('names the start-time basis beside a status, and nothing on a token or an empty status', () => {
    expect(withLivenessBasis('working', 'start-time')).toBe('working · liveness by start time');
    expect(withLivenessBasis('working', 'token')).toBe('working');
    expect(withLivenessBasis('working', '')).toBe('working');
    expect(withLivenessBasis('', 'start-time')).toBe('');
  });
});
