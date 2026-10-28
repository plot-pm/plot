import { describe, expect, it } from 'vitest';

import {
  decodeFleetStopped,
  encodeFleetStopped,
  FLEET_STOPPED_VERSION,
  type FleetStopped,
} from '../src/entities/fleet-stopped.js';

const record = (overrides: Partial<FleetStopped> = {}): FleetStopped => ({
  v: FLEET_STOPPED_VERSION,
  branches: ['feature/a', 'feature/b'],
  at: '2026-10-27T10:00:00.000Z',
  ...overrides,
});

describe('decodeFleetStopped', () => {
  it('round-trips a record', () => {
    const r = record();
    expect(decodeFleetStopped(encodeFleetStopped(r))).toEqual(r);
  });

  it('round-trips an empty branch list', () => {
    const r = record({ branches: [] });
    expect(decodeFleetStopped(encodeFleetStopped(r))).toEqual(r);
  });

  it('reads a file with another version as no record', () => {
    const other = JSON.stringify({ ...record(), v: FLEET_STOPPED_VERSION + 1 });
    expect(decodeFleetStopped(other)).toBeNull();
  });

  it.each(['', '   ', '{not json', '[]', '{"v":1}'])('reads %j as no record', (text) => {
    expect(decodeFleetStopped(text)).toBeNull();
  });
});
