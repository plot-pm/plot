import { describe, expect, it } from 'vitest';

import { bridgeIsFresh, fleetHoldsBridge, fleetOwnsScan, OWNED_ATTEMPT_MAX_AGE_MS, OWNED_BRIDGE_MAX_AGE_MS, ownedBridgeNote } from '../src/rules/scan-owner.js';

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

describe('bridgeIsFresh', () => {
  it('is true up to the age bound and false one millisecond past it', () => {
    expect(bridgeIsFresh(NOW - OWNED_BRIDGE_MAX_AGE_MS, NOW)).toBe(true);
    expect(bridgeIsFresh(NOW - OWNED_BRIDGE_MAX_AGE_MS - 1, NOW)).toBe(false);
  });
  it('is false with no bridge, and for a bridge from the future', () => {
    expect(bridgeIsFresh(null, NOW)).toBe(false);
    expect(bridgeIsFresh(NOW + 1, NOW)).toBe(false);
  });
});

describe('fleetHoldsBridge', () => {
  it('is true for a fresh bridge that carries timer facts', () => {
    expect(fleetHoldsBridge({ bridgeAt: NOW - 5_000, carriesTimerFacts: true, now: NOW })).toBe(true);
  });
  it('is false for a fresh thin bridge, which only the scan writes', () => {
    expect(fleetHoldsBridge({ bridgeAt: NOW - 5_000, carriesTimerFacts: false, now: NOW })).toBe(false);
  });
  it('is false for a stale bridge that carries timer facts (a stopped fleet)', () => {
    expect(fleetHoldsBridge({ bridgeAt: NOW - OWNED_BRIDGE_MAX_AGE_MS - 1, carriesTimerFacts: true, now: NOW })).toBe(false);
  });
  it('is false with no bridge', () => {
    expect(fleetHoldsBridge({ bridgeAt: null, carriesTimerFacts: false, now: NOW })).toBe(false);
  });
});

describe('fleetOwnsScan with a scan attempt', () => {
  it('is true for a live fleet whose last scan started 100 s ago and whose bridge is 200 s old', () => {
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW - 200_000, lastAttemptStartedAt: NOW - 100_000, now: NOW })).toBe(true);
  });
  it('is false for a live fleet that started no scan within the attempt bound', () => {
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW - 400_000, lastAttemptStartedAt: NOW - OWNED_ATTEMPT_MAX_AGE_MS - 1, now: NOW })).toBe(false);
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW - 400_000, lastAttemptStartedAt: NOW - OWNED_ATTEMPT_MAX_AGE_MS, now: NOW })).toBe(true);
  });
  it('is false for a stopped fleet however recent its attempt', () => {
    expect(fleetOwnsScan({ supervisor: DOWN, bridgeAt: NOW - 200_000, lastAttemptStartedAt: NOW - 1_000, now: NOW })).toBe(false);
  });
  it('is false for an attempt from the future, and with no bridge at all', () => {
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: NOW - 200_000, lastAttemptStartedAt: NOW + 1, now: NOW })).toBe(false);
    expect(fleetOwnsScan({ supervisor: UP, bridgeAt: null, lastAttemptStartedAt: NOW - 1_000, now: NOW })).toBe(false);
  });
});

describe('ownedBridgeNote', () => {
  it('is null while the bridge is fresh', () => {
    expect(ownedBridgeNote({ bridgeAt: NOW - 5_000, attempt: null, now: NOW })).toBeNull();
  });
  it('names the bridge age and the last failure for a stale owned bridge', () => {
    const note = ownedBridgeNote({
      bridgeAt: NOW - 200_000,
      attempt: { startedAt: NOW - 100_000, outcome: 'failed', error: 'scan exceeded 90 s' },
      now: NOW,
    });
    expect(note).toContain('200 s ago');
    expect(note).toContain('scan exceeded 90 s');
  });
  it('names only the age when the last attempt did not fail', () => {
    const note = ownedBridgeNote({ bridgeAt: NOW - 200_000, attempt: { startedAt: NOW - 50_000, outcome: 'running', error: null }, now: NOW });
    expect(note).toContain('200 s ago');
    expect(note).not.toContain('failed');
  });
});
