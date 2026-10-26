import { describe, it, expect } from 'vitest';

import { writeProbeAnswer, writeProbeRefusal } from '../src/rules/write-probe.js';

describe('writeProbeAnswer — absent is not false', () => {
  it('refuses only on an observed no', () => {
    expect(writeProbeAnswer('no')).toBe('refuse');
  });

  it('proceeds on an observed yes', () => {
    expect(writeProbeAnswer('yes')).toBe('proceed');
  });

  it('proceeds on unanswerable, the same as yes', () => {
    // THE WHOLE POINT. A probe that could not run observed nothing, and
    // refusing on it would turn an absent harness or a timed-out run into a
    // false permission fault.
    expect(writeProbeAnswer('unanswerable')).toBe('proceed');
  });
});

describe('writeProbeRefusal — one fault, one wording', () => {
  it('names the detail it was given', () => {
    expect(writeProbeRefusal('no marker file appeared')).toContain('no marker file appeared');
  });

  it('says so when no detail was recorded, rather than printing nothing', () => {
    expect(writeProbeRefusal('')).toContain('no detail was recorded');
  });
});
