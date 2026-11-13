import { FLEETD_HEARTBEAT_VERSION, type FleetdHeartbeat } from '../src/entities/fleetd-heartbeat.js';
import { describe, expect, it } from 'vitest';
import { boardChannelOf, boardSource, boardSourceOf, coldReadDue, pulseWanted, readerWanted, type BoardSourceFacts, type BoardSourceReading, type ColdReadReading, type ReaderWatchReading } from '../src/rules/board-watch.js';

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

const reader = (over: Partial<ReaderWatchReading>): ReaderWatchReading => ({
  clients: 1,
  verdict: 'elect',
  fleetdLive: false,
  ...over,
});

describe('readerWanted', () => {
  it('answers true with a client attached, an elect verdict and no live fleetd', () => {
    expect(readerWanted(reader({}))).toBe(true);
  });

  it('answers false with no client attached', () => {
    expect(readerWanted(reader({ clients: 0 }))).toBe(false);
  });

  it('answers false while a live fleetd heartbeat reads PRs', () => {
    expect(readerWanted(reader({ fleetdLive: true }))).toBe(false);
  });

  it('answers false where another live holder reads PRs', () => {
    expect(readerWanted(reader({ verdict: 'follow' }))).toBe(false);
  });

  it('answers false where the lock could not be read', () => {
    expect(readerWanted(reader({ verdict: 'unknown' }))).toBe(false);
  });
});

describe('boardSource', () => {
  const live: BoardSourceReading = { clients: 1, fleetd: 'live', observerFresh: true, channel: 'current' };

  it('answers snapshot for a live fleetd, a fresh observer and a current channel with one client', () => {
    expect(boardSource(live)).toBe('snapshot');
  });

  it.each([
    ['a stale heartbeat', { fleetd: 'stale' as const }],
    ['an absent heartbeat', { fleetd: 'absent' as const }],
    ['a stale observer', { observerFresh: false }],
    ['a protocol mismatch', { channel: 'mismatch' as const }],
    ['a resyncing channel', { channel: 'resyncing' as const }],
    ['no snapshot held', { channel: 'none' as const }],
  ])('answers own with one client and %s', (_name, over) => {
    expect(boardSource({ ...live, ...over })).toBe('own');
  });

  it.each([
    ['a live fleetd', live],
    ['a mismatched channel', { ...live, channel: 'mismatch' as const }],
  ])('answers idle with no client and %s', (_name, reading) => {
    expect(boardSource({ ...reading, clients: 0 })).toBe('idle');
  });
});

describe('boardChannelOf', () => {
  it('answers none where the board has no hub', () => {
    expect(boardChannelOf(undefined)).toBe('none');
  });

  it('answers none for an absent link', () => {
    expect(boardChannelOf({ state: 'absent' })).toBe('none');
  });

  it.each([
    [{ state: 'current' as const, epoch: 'e', generation: 3 }, 'current'],
    [{ state: 'resyncing' as const, reason: 'gap' }, 'resyncing'],
    [{ state: 'mismatch' as const, reason: 'old', ours: 2, theirs: 1 }, 'mismatch'],
  ])('answers the link state %o', (link, expected) => {
    expect(boardChannelOf(link)).toBe(expected);
  });
});

describe('boardSourceOf', () => {
  const NOW = 1_800_000_000_000;
  const heartbeat = (beatAt: number, loops: FleetdHeartbeat['loops'] = {}): FleetdHeartbeat => ({
    version: FLEETD_HEARTBEAT_VERSION,
    pid: 1,
    startedAt: beatAt - 600_000,
    beatAt,
    generation: 1,
    bridgeAt: null,
    supervised: 'launchd',
    watchesWanted: 0,
    watchesArmed: 0,
    lastEventAt: null,
    lastSafetyNetAt: null,
    loops,
  });
  const current = { state: 'current' as const, epoch: 'e', generation: 1 };
  const facts = (over: Partial<BoardSourceFacts> = {}): BoardSourceFacts => ({
    clients: 1,
    heartbeat: heartbeat(NOW),
    link: current,
    now: NOW,
    ...over,
  });

  it('answers snapshot for a live heartbeat with no late loop and a current link', () => {
    expect(boardSourceOf(facts())).toBe('snapshot');
  });

  it('answers own for a stale heartbeat', () => {
    expect(boardSourceOf(facts({ heartbeat: heartbeat(NOW - 600_000) }))).toBe('own');
  });

  it('answers own with no heartbeat', () => {
    expect(boardSourceOf(facts({ heartbeat: null }))).toBe('own');
  });

  it('answers snapshot for a quiet scan loop under a fresh beat', () => {
    expect(boardSourceOf(facts({ heartbeat: heartbeat(NOW, { scan: { lastPassAt: NOW - 86_400_000 } }) }))).toBe('snapshot');
  });

  it('answers own for a late loop', () => {
    expect(boardSourceOf(facts({ heartbeat: heartbeat(NOW, { 'pr-reader': { lastPassAt: NOW - 86_400_000 } }) }))).toBe('own');
  });

  it('answers own with no hub', () => {
    expect(boardSourceOf(facts({ link: undefined }))).toBe('own');
  });

  it('answers idle with no client', () => {
    expect(boardSourceOf(facts({ clients: 0 }))).toBe('idle');
  });
});
