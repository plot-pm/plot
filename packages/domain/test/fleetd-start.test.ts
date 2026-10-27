import { describe, expect, it } from 'vitest';
import { FLEETD_START_VERSION, decodeFleetdStart, encodeFleetdStart, type FleetdStart } from '../src/entities/fleetd-start.js';

const record: FleetdStart = {
  v: FLEETD_START_VERSION,
  pid: 4242,
  startedAt: 1_700_000_000_000,
  spawnContract: 1,
  bundlePath: '/repo/skills/plot/scripts/board/plot-fleetd.mjs',
  bundleHash: 'abc123',
};

describe('decodeFleetdStart', () => {
  it('reads back what encodeFleetdStart wrote', () => {
    expect(decodeFleetdStart(encodeFleetdStart(record))).toEqual(record);
  });

  it('reads an empty or blank file as no record', () => {
    expect(decodeFleetdStart('')).toBeNull();
    expect(decodeFleetdStart(' \n')).toBeNull();
  });

  it('reads a torn write as no record', () => {
    expect(decodeFleetdStart('{"v":1,"pid":')).toBeNull();
  });

  it('reads another version as no record', () => {
    expect(decodeFleetdStart(JSON.stringify({ ...record, v: 2 }))).toBeNull();
  });

  it('reads an unknown field as no record', () => {
    expect(decodeFleetdStart(JSON.stringify({ ...record, extra: true }))).toBeNull();
  });
});

describe('encodeFleetdStart', () => {
  it('writes one JSON line ending in a newline', () => {
    const text = encodeFleetdStart(record);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')).toHaveLength(2);
    expect(JSON.parse(text)).toEqual(record);
  });
});
