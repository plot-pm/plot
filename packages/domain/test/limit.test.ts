import { describe, it, expect } from 'vitest';

import {
  actualLimit,
  correctForRefusal,
  limitFailureMode,
  LimitBasisSchema,
  MIN_PREDICTED_LIMIT,
  predictedLimit,
  unknownLimit,
  type LimitReading,
} from '../src/entities/limit.js';

/**
 * What a connector answers about its own limit, and how well it knows it.
 *
 * TWO THINGS ARE UNDER TEST AND THEY ARE DIFFERENT. The BASIS says how a
 * reading was come by — `actual` from the connector, `predicted` from the
 * adapter's experience, `unknown` from neither. The CORRECTION says what a
 * refusal does to it, and it is the piece a static default cannot have.
 *
 * THE CORRECTION TEST HAS TO BE DISCRIMINATING. Asserting that a reading's
 * basis is still `predicted` after a refusal passes against a value that never
 * learns anything, so every case below asserts the NUMBER moved.
 */

describe('a limit reading says how it was come by', () => {
  it('names three bases and no more', () => {
    // A fourth would be a value some caller reads and no adapter can produce.
    expect(LimitBasisSchema.options).toEqual(['actual', 'predicted', 'unknown']);
  });

  it('tags what the connector itself reported as actual', () => {
    const reading = actualLimit({
      connector: 'github',
      bucket: 'graphql',
      limit: 5000,
      remaining: 1236,
      resetAt: 1_788_269_670_000,
    });
    expect(reading).toEqual({
      connector: 'github',
      bucket: 'graphql',
      limit: 5000,
      remaining: 1236,
      resetAt: 1_788_269_670_000,
      basis: 'actual',
    });
  });

  it('tags a value from experience as predicted, and reports no remaining', () => {
    // A prediction is about the CEILING. A connector that reports no limit
    // reports no spend against one either, so inventing a `remaining` would let
    // a caller read a guess as a measurement.
    expect(predictedLimit('jenkins', '', 60)).toEqual({
      connector: 'jenkins',
      bucket: '',
      limit: 60,
      remaining: null,
      resetAt: null,
      basis: 'predicted',
    });
  });

  it('records a connector with no limit as unknown, never as free', () => {
    // THE REPO HAS TWICE SHIPPED A COLLAPSE OF *cannot answer* INTO A VALUE.
    // The limit is null — absent — and the basis says why. Nothing here reads
    // as unlimited, and nothing reads as zero either.
    const reading = unknownLimit('trello');
    expect(reading.limit).toBeNull();
    expect(reading.basis).toBe('unknown');
    expect(reading.limit).not.toBe(0);
  });

  it('names how each basis goes wrong', () => {
    // The same shape `stateFailureMode` has, one level down: a vocabulary is
    // worth having only if it says what each of its members costs.
    expect(limitFailureMode('actual')).toBe('decaying instantly');
    expect(limitFailureMode('predicted')).toMatch(/wrong/);
    expect(limitFailureMode('unknown')).toMatch(/free/);
  });

  it('carries the connector and the bucket as the connector’s own words', () => {
    // Not validated, and that is the design: `Tracker` already names `linear`
    // without an adapter, and a third closed enum is the edit that gets
    // forgotten when GitLab arrives.
    const reading = predictedLimit('a-connector-nobody-has-written', 'its-own-bucket', 7);
    expect(reading.connector).toBe('a-connector-nobody-has-written');
    expect(reading.bucket).toBe('its-own-bucket');
  });
});

describe('a refusal corrects the prediction it disproved', () => {
  it('LOWERS the number, not merely the tag', () => {
    // The discriminating assertion. A test checking only that the basis is
    // still `predicted` passes against a reading that learns nothing.
    const before = predictedLimit('jenkins', '', 60);
    const after = correctForRefusal(before, 'throttled');
    expect(after.limit).toBeLessThan(60);
    expect(after.limit).toBe(30);
  });

  it('converges over repeated refusals rather than stepping once', () => {
    // Halving, because a refusal says only *lower than this* and carries no
    // number of its own. A wildly wrong guess and a nearly-right one both
    // converge in a session's worth of refusals.
    let reading = predictedLimit('jenkins', '', 1000);
    const seen: (number | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      reading = correctForRefusal(reading, 'throttled');
      seen.push(reading.limit);
    }
    expect(seen).toEqual([500, 250, 125, 62]);
  });

  it('never drives a prediction to zero', () => {
    // A refusal proves the guess was too high, not that the connector is shut.
    // A ceiling of zero is a connector that can never be called again, which no
    // observation licenses.
    let reading = predictedLimit('jenkins', '', 4);
    for (let i = 0; i < 20; i += 1) reading = correctForRefusal(reading, 'throttled');
    expect(reading.limit).toBe(MIN_PREDICTED_LIMIT);
    expect(reading.limit).toBeGreaterThan(0);
  });

  it('leaves an ACTUAL reading alone', () => {
    // What the connector itself said. A refusal beside it means something other
    // than a wrong ceiling — a secondary limit, a burst — and lowering the
    // reported number would overwrite a measurement with an inference.
    const measured = actualLimit({
      connector: 'github',
      bucket: 'graphql',
      limit: 5000,
      remaining: 0,
      resetAt: 1_788_269_670_000,
    });
    expect(correctForRefusal(measured, 'throttled')).toEqual(measured);
  });

  it('leaves an UNKNOWN reading alone, having nothing to correct', () => {
    const nothing = unknownLimit('trello');
    expect(correctForRefusal(nothing, 'throttled')).toEqual(nothing);
  });

  it('learns nothing from a call that succeeded', () => {
    // Only a refusal is evidence. A call that went through says the ceiling is
    // at least this high, which the prediction already claims.
    const before = predictedLimit('jenkins', '', 60);
    expect(correctForRefusal(before, 'ok')).toEqual(before);
  });

  it('returns a new reading rather than mutating the one it was given', () => {
    // The domain takes readings as VALUES. A caller holding the pre-correction
    // reading must still hold it.
    const before = predictedLimit('jenkins', '', 60);
    const after = correctForRefusal(before, 'throttled');
    expect(before.limit).toBe(60);
    expect(after).not.toBe(before);
  });

  it('corrects a prediction whose limit is already the floor without moving it', () => {
    const floored: LimitReading = predictedLimit('jenkins', '', MIN_PREDICTED_LIMIT);
    expect(correctForRefusal(floored, 'throttled').limit).toBe(MIN_PREDICTED_LIMIT);
  });
});
