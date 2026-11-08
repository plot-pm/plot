import { describe, expect, it } from 'vitest';

import { FLEETD_HEARTBEAT_VERSION, type FleetdHeartbeat } from '../src/entities/fleetd-heartbeat.js';
import { fleetdFacts, supervisorSource } from '../src/rules/fleetd-supervisor.js';
import { supervisorState } from '../src/rules/supervisor-reading.js';

const T0 = 1_700_000_000_000;

const heartbeat = (overrides: Partial<FleetdHeartbeat> = {}): FleetdHeartbeat => ({
  version: FLEETD_HEARTBEAT_VERSION,
  pid: 4242,
  startedAt: T0 - 600_000,
  beatAt: T0,
  generation: 7,
  bridgeAt: null,
  supervised: 'launchd',
  watchesWanted: 0,
  watchesArmed: 0,
  lastEventAt: null,
  lastSafetyNetAt: null,
  loops: {},
  ...overrides,
});

describe('supervisorSource', () => {
  it('reads up from a live heartbeat of a supervised fleetd, with no script', () => {
    const actual = supervisorSource(heartbeat(), T0 + 10_000);
    expect(actual.source).toBe('heartbeat');
    if (actual.source === 'heartbeat') expect(supervisorState(actual.run)).toBe('up');
  });

  it('reads systemd the same way', () => {
    expect(supervisorSource(heartbeat({ supervised: 'systemd' }), T0).source).toBe('heartbeat');
  });

  it('asks the script for a stale heartbeat', () => {
    expect(supervisorSource(heartbeat(), T0 + 31_000)).toEqual({ source: 'script' });
  });

  it('asks the script for an absent heartbeat', () => {
    expect(supervisorSource(null, T0)).toEqual({ source: 'script' });
  });

  it('asks the script for a live heartbeat of a fleetd started by hand', () => {
    expect(supervisorSource(heartbeat({ supervised: 'none' }), T0)).toEqual({ source: 'script' });
  });

  it('asks the script while a live heartbeat reports a tick that stopped passing', () => {
    const wedged = heartbeat({ beatAt: T0 + 700_000, loops: { tick: { lastPassAt: T0 } } });
    expect(supervisorSource(wedged, T0 + 700_000)).toEqual({ source: 'script' });
  });

  it('keeps the heartbeat while every reported loop is within its bound', () => {
    const fresh = heartbeat({ loops: { tick: { lastPassAt: T0 - 60_000 }, scan: { lastPassAt: T0 - 90_000 } } });
    expect(supervisorSource(fresh, T0).source).toBe('heartbeat');
  });
});

describe('fleetdFacts', () => {
  it('reports the file and the channel side by side', () => {
    expect(fleetdFacts(heartbeat(), 'down', T0)).toEqual({ file: 'live', channel: 'down' });
    expect(fleetdFacts(null, 'up', T0)).toEqual({ file: 'absent', channel: 'up' });
    expect(fleetdFacts(heartbeat(), 'unknown', T0 + 99_000)).toEqual({ file: 'stale', channel: 'unknown' });
  });
});
