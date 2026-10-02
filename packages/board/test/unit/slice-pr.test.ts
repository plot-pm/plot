import { describe, it, expect } from 'vitest';
import { readingsFrom, requestFrom } from '../../src/server/entry/slice-pr.js';

/**
 * THE ENTRY IS AN ADAPTER AND THESE TEST THE ADAPTATION.
 *
 * `openSlicePr`'s own answers are asserted in the domain, once. What can only
 * fail here is the translation: what an absent field means, and what a row the
 * entry cannot read becomes.
 */
describe('readingsFrom — the PR rows', () => {
  it('reads an absent `prs` as no rows found', () => {
    // A MISSING ANSWER IS NOT A NEGATIVE ONE, and here the two agree: the
    // outage path is `pr-list` failing, which gives the shell no rows at all.
    // It never means *closed*.
    expect(readingsFrom({}).prs).toEqual([]);
  });

  it('reads a `prs` that is not an array as no rows found', () => {
    expect(readingsFrom({ prs: 1089 }).prs).toEqual([]);
    expect(readingsFrom({ prs: { number: 1089, state: 'OPEN' } }).prs).toEqual([]);
    expect(readingsFrom({ prs: null }).prs).toEqual([]);
  });

  it('reads the three states the host reports', () => {
    expect(
      readingsFrom({
        prs: [
          { number: 1102, state: 'OPEN' },
          { number: 1049, state: 'MERGED' },
          { number: 1089, state: 'CLOSED' },
        ],
      }).prs,
    ).toEqual([
      { number: 1102, state: 'OPEN' },
      { number: 1049, state: 'MERGED' },
      { number: 1089, state: 'CLOSED' },
    ]);
  });

  it('reads an unknown state as OPEN, so a parse defect refuses', () => {
    // AN UNKNOWN STATE COUNTS AS CARRYING. The opposite direction opens a
    // duplicate PR on a parse defect, and Bitbucket does not always refuse a
    // duplicate, so the host is no safety net there.
    expect(readingsFrom({ prs: [{ number: 7, state: 'DECLINED' }] }).prs).toEqual([
      { number: 7, state: 'OPEN' },
    ]);
    expect(readingsFrom({ prs: [{ number: 7, state: 'open' }] }).prs).toEqual([
      { number: 7, state: 'OPEN' },
    ]);
  });

  it('reads a missing or unreadable state as OPEN too', () => {
    expect(readingsFrom({ prs: [{ number: 7 }] }).prs).toEqual([{ number: 7, state: 'OPEN' }]);
    expect(readingsFrom({ prs: [{ number: 7, state: 42 }] }).prs).toEqual([
      { number: 7, state: 'OPEN' },
    ]);
    expect(readingsFrom({ prs: [{ number: 7, state: null }] }).prs).toEqual([
      { number: 7, state: 'OPEN' },
    ]);
  });

  it('drops a row with no usable number', () => {
    // A row naming no PR cannot be refused on and cannot be named in a body.
    expect(
      readingsFrom({
        prs: [
          { state: 'OPEN' },
          { number: 0, state: 'OPEN' },
          { number: 'eleven', state: 'OPEN' },
          { number: -3, state: 'CLOSED' },
          { number: 1089, state: 'CLOSED' },
        ],
      }).prs,
    ).toEqual([{ number: 1089, state: 'CLOSED' }]);
  });

  it('drops a row that is not an object', () => {
    expect(readingsFrom({ prs: [1089, null, 'OPEN', { number: 1102, state: 'OPEN' }] }).prs).toEqual(
      [{ number: 1102, state: 'OPEN' }],
    );
  });

  it('truncates a fractional number the way every other count is read', () => {
    expect(readingsFrom({ prs: [{ number: 1089.7, state: 'CLOSED' }] }).prs).toEqual([
      { number: 1089, state: 'CLOSED' },
    ]);
  });
});

describe('requestFrom — the whole request', () => {
  it('carries the rows through from stdin', () => {
    const request = requestFrom(
      JSON.stringify({
        draft: true,
        readings: {
          branch: 'bug/a-closed-pr-carries-no-branch',
          base: 'main',
          prs: [{ number: 1089, state: 'CLOSED' }],
          commits: 2,
          carriedWork: true,
        },
      }),
    );

    expect(request.draft).toBe(true);
    expect(request.readings.prs).toEqual([{ number: 1089, state: 'CLOSED' }]);
    expect(request.readings.commits).toBe(2);
  });

  it('reads a request carrying no rows as no rows found', () => {
    const request = requestFrom(JSON.stringify({ readings: { branch: 'feature/x' } }));

    expect(request.readings.prs).toEqual([]);
  });
});
