import { describe, expect, it } from 'vitest';

import {
  withLivenessBasis,
  workerLiveness,
  type TokenReading,
  type LivenessReadings,
} from '../src/rules/worker-liveness.js';

const MADE = 1_000_000;
const BOUND = 28_800_000;
const held: TokenReading = { state: 'held', madeAtMs: MADE };
const released: TokenReading = { state: 'released', madeAtMs: MADE };

const desk = (over: Partial<LivenessReadings> = {}): LivenessReadings => ({
  exitAtMs: null,
  exitCode: null,
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

  it('lets a held token outrank a current exit record of a signal death', () => {
    const killed = { exitAtMs: MADE + 5, exitCode: 137 };
    expect(workerLiveness(desk(killed))).toEqual({ basis: 'token', liveness: 'live', exitCurrent: true });
    expect(workerLiveness(desk({ ...killed, pidAnswers: false }))).toEqual({ basis: 'token', liveness: 'stray-holder', exitCurrent: true });
    expect(workerLiveness(desk({ ...killed, exitCode: 143, pidAnswers: false }))).toMatchObject({ liveness: 'stray-holder' });
    expect(workerLiveness(desk({ ...killed, exitCode: 128, pidAnswers: false }))).toMatchObject({ liveness: 'stray-holder' });
    expect(workerLiveness(desk({ ...killed, pidAnswers: false, nowMs: MADE + BOUND }))).toEqual({ basis: 'token', liveness: 'dead', exitCurrent: true });
  });

  it('keeps exited for a held token beside a current exit record below 128, and for a released token beside a signal death', () => {
    expect(workerLiveness(desk({ exitAtMs: MADE + 5, exitCode: 0 }))).toMatchObject({ liveness: 'exited' });
    expect(workerLiveness(desk({ exitAtMs: MADE + 5, exitCode: 127, pidAnswers: false }))).toMatchObject({ liveness: 'exited' });
    expect(workerLiveness(desk({ exitAtMs: MADE + 5, exitCode: 137, token: released }))).toEqual({ basis: 'token', liveness: 'exited', exitCurrent: true });
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

  it('reads a held token with an answering pid as live past Worker bound, and a stray holder past it as dead', () => {
    const past = { nowMs: MADE + BOUND };
    expect(workerLiveness(desk(past))).toMatchObject({ liveness: 'live' });
    expect(workerLiveness(desk({ ...past, pidAnswers: false }))).toMatchObject({ liveness: 'dead' });
    expect(workerLiveness(desk({ nowMs: MADE + BOUND - 1, pidAnswers: false }))).toMatchObject({ liveness: 'stray-holder' });
  });

  it('sets no ceiling with a bound of 0 or no recorded start', () => {
    expect(workerLiveness(desk({ nowMs: MADE + 10 * BOUND, workerBoundMs: 0, pidAnswers: false }))).toMatchObject({ liveness: 'stray-holder' });
    expect(workerLiveness(desk({ nowMs: MADE + 10 * BOUND, startedAtMs: null, pidAnswers: false }))).toMatchObject({ liveness: 'stray-holder' });
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
