import { describe, expect, it } from 'vitest';

import { fleetOwnsScan, OWNED_BRIDGE_MAX_AGE_MS } from '../src/rules/scan-owner.js';

const UP = { asked: true, exitCode: 0, summarised: true };
const DOWN = { asked: true, exitCode: 1, summarised: true, install: 'not-installed' };
const NOW = 1_000_000_000;

describe('fleetOwnsScan', () => {
  it('is true for a supervisor that is up and a fresh bridge', () => {
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW - 5_000, now: NOW })).toBe(true);
  });
  it('is true at the age bound and false one millisecond past it', () => {
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW - OWNED_BRIDGE_MAX_AGE_MS, now: NOW })).toBe(true);
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW - OWNED_BRIDGE_MAX_AGE_MS - 1, now: NOW })).toBe(false);
  });
  it('is false for a loaded supervisor whose bridge went stale (a hung daemon)', () => {
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW - 600_000, now: NOW })).toBe(false);
  });
  it('is false for a fresh bridge with no supervisor up', () => {
    expect(fleetOwnsScan({ supervisor: DOWN, bridgeAt: NOW - 1_000, now: NOW })).toBe(false);
    expect(fleetOwnsScan({ supervisor: undefined, bridgeAt: NOW - 1_000, now: NOW })).toBe(false);
  });
  it('is false for a fresh bridge with a supervisor that died', () => {
    const died = { asked: true, exitCode: 1, summarised: true, install: 'installed' };
    expect(fleetOwnsScan({ supervisor: died, bridgeAt: NOW - 1_000, now: NOW })).toBe(false);
  });
  it('is true for an unknown supervisor reading and a fresh bridge', () => {
    const cutShort = { asked: true, exitCode: 1, summarised: false };
    const notAsked = { asked: false, exitCode: null, summarised: false };
    expect(fleetOwnsScan({ supervisor: cutShort, bridgeAt: NOW - 5_000, now: NOW })).toBe(true);
    expect(fleetOwnsScan({ supervisor: notAsked, bridgeAt: NOW, now: NOW })).toBe(true);
  });
  it('is false for an unknown supervisor reading and a stale bridge', () => {
    const cutShort = { asked: true, exitCode: 1, summarised: false };
    expect(fleetOwnsScan({ supervisor: cutShort, bridgeAt: NOW - OWNED_BRIDGE_MAX_AGE_MS - 1, now: NOW })).toBe(false);
  });
  it('is false with no bridge, and for a bridge from the future', () => {
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: null, now: NOW })).toBe(false);
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW + 1, now: NOW })).toBe(false);
  });
});
