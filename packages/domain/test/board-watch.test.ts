import { describe, expect, it } from 'vitest';
import { coldReadDue, pulseWanted, type ColdReadReading } from '../src/rules/board-watch.js';

describe('pulseWanted', () => {
  it('answers false with no client attached', () => {
    expect(pulseWanted({ clients: 0 })).toBe(false);
  });

  it('answers true with one client attached', () => {
    expect(pulseWanted({ clients: 1 })).toBe(true);
  });

  it('answers true with several clients attached', () => {
    expect(pulseWanted({ clients: 3 })).toBe(true);
  });
});

const cold = (over: Partial<ColdReadReading>): ColdReadReading => ({
  pulseRunning: false,
  scanning: false,
  lastScanAt: null,
  lastColdReadAt: null,
  now: 100_000,
  refreshMs: 5_000,
  ...over,
});

describe('coldReadDue', () => {
  it('reads once when nothing was ever read', () => {
    expect(coldReadDue(cold({}))).toBe(true);
  });

  it('reads nothing while the pulse runs', () => {
    expect(coldReadDue(cold({ pulseRunning: true }))).toBe(false);
  });

  it('reads nothing while a scan runs', () => {
    expect(coldReadDue(cold({ scanning: true }))).toBe(false);
  });

  it('reads nothing while the last scan is younger than the refresh period', () => {
    expect(coldReadDue(cold({ lastScanAt: 96_000 }))).toBe(false);
  });

  it('reads once the last scan is as old as the refresh period', () => {
    expect(coldReadDue(cold({ lastScanAt: 95_000 }))).toBe(true);
  });

  it('reads nothing while the last cold read is younger than the period, whatever the scan age', () => {
    // A scan stamped with an old fleetd bridge time, or a scan that failed, leaves
    // `lastScanAt` old; the cold read's own start bounds the next one.
    expect(coldReadDue(cold({ lastScanAt: 1_000, lastColdReadAt: 99_000 }))).toBe(false);
  });

  it('reads once both the scan and the cold read are as old as the period', () => {
    expect(coldReadDue(cold({ lastScanAt: 1_000, lastColdReadAt: 95_000 }))).toBe(true);
  });

  it('reads once on a clock that moved backwards', () => {
    expect(coldReadDue(cold({ lastScanAt: 200_000 }))).toBe(true);
  });
});
