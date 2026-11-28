import { describe, expect, it } from 'vitest';

import { deskQuietSeconds } from '../src/rules/desk-quiet.js';

const now = 1_800_000_000_000;
const ago = (seconds: number): number => now - seconds * 1000;

describe('deskQuietSeconds', () => {
  it('answers the age of the newest signal, not the first or the log', () => {
    expect(deskQuietSeconds({ passMs: ago(400), monitorMs: ago(30), headMs: ago(900), logMs: ago(7000) }, now)).toBe(30);
    expect(deskQuietSeconds({ passMs: ago(400), monitorMs: ago(300), headMs: ago(90), logMs: ago(7000) }, now)).toBe(90);
  });

  it('reads an old log with a new pass file from the pass file', () => {
    expect(deskQuietSeconds({ passMs: ago(120), logMs: ago(7178) }, now)).toBe(120);
  });

  it('answers null where no signal can be read', () => {
    expect(deskQuietSeconds({}, now)).toBeNull();
    expect(deskQuietSeconds({ passMs: null, monitorMs: null, headMs: null, logMs: null }, now)).toBeNull();
  });

  it('answers from the signals that exist and skips the absent ones', () => {
    expect(deskQuietSeconds({ headMs: ago(500), logMs: null }, now)).toBe(500);
    expect(deskQuietSeconds({ logMs: ago(60) }, now)).toBe(60);
  });

  it('clamps a time in the future to age 0', () => {
    expect(deskQuietSeconds({ passMs: now + 5000, logMs: ago(100) }, now)).toBe(0);
  });
});
