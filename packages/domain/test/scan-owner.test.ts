import { describe, expect, it } from 'vitest';

import { FLEETD_HEARTBEAT_VERSION, type FleetdHeartbeat } from '../src/entities/fleetd-heartbeat.js';
import { bridgeIsFresh, fleetHoldsBridge, fleetOwnsScan, OWNED_BRIDGE_MAX_AGE_MS, ownedBridgeNote } from '../src/rules/scan-owner.js';

const NOW = 1_700_000_000_000;

const beat = (overrides: Partial<FleetdHeartbeat> = {}): FleetdHeartbeat => ({
  version: FLEETD_HEARTBEAT_VERSION,
  pid: 4242,
  startedAt: NOW - 600_000,
  beatAt: NOW,
  generation: 1,
  bridgeAt: null,
  supervised: 'none',
  watchesWanted: 0,
  watchesArmed: 0,
  lastEventAt: null,
  lastSafetyNetAt: null,
  loops: {},
  ...overrides,
});

describe('fleetOwnsScan', () => {
  it('is true while the heartbeat is live and every loop is fresh', () => {
    expect(fleetOwnsScan({ heartbeat: beat(), now: NOW })).toBe(true);
    expect(fleetOwnsScan({ heartbeat: beat({ beatAt: NOW - 30_000 }), now: NOW })).toBe(true);
  });
  it('stays true for an idle repository whose bridge is 20 minutes old', () => {
    expect(fleetOwnsScan({ heartbeat: beat({ bridgeAt: NOW - 20 * 60_000 }), now: NOW })).toBe(true);
  });
  it('is false for a stale heartbeat', () => {
    expect(fleetOwnsScan({ heartbeat: beat({ beatAt: NOW - 31_000 }), now: NOW })).toBe(false);
  });
  it('is false for an absent heartbeat', () => {
    expect(fleetOwnsScan({ heartbeat: null, now: NOW })).toBe(false);
  });
  it('is false while a loop is late under a fresh beat', () => {
    expect(fleetOwnsScan({ heartbeat: beat({ loops: { scan: { lastPassAt: NOW - 181_000 } } }), now: NOW })).toBe(false);
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
  it('says no reason was recorded for a failed attempt that carries none', () => {
    const note = ownedBridgeNote({ bridgeAt: NOW - 200_000, attempt: { startedAt: NOW - 100_000, outcome: 'failed', error: null }, now: NOW });
    expect(note).toContain('no reason recorded');
  });
  it('names only the age when the last attempt did not fail', () => {
    const note = ownedBridgeNote({ bridgeAt: NOW - 200_000, attempt: { startedAt: NOW - 50_000, outcome: 'running', error: null }, now: NOW });
    expect(note).toContain('200 s ago');
    expect(note).not.toContain('failed');
  });
});

describe('ownedBridgeNote with a late loop', () => {
  it('names the loop whose pass is late', () => {
    const note = ownedBridgeNote({ bridgeAt: NOW - 200_000, attempt: null, lateLoops: ['scan'], now: NOW });
    expect(note).toBe("the fleet's last scan landed 200 s ago; its scan loop has not completed a pass in time");
  });
  it('keeps the under-way sentence with no late loop', () => {
    expect(ownedBridgeNote({ bridgeAt: NOW - 200_000, attempt: null, lateLoops: [], now: NOW })).toContain('next is under way');
  });
});
