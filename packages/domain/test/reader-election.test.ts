import { describe, expect, it } from 'vitest';

import {
  electReader,
  heartbeatIsFresh,
  readerIsStale,
  HEARTBEAT_STALE_MS,
  READER_LOCK_SKEW_MS,
  READER_STALE_MS,
  type ReaderClaim,
} from '../src/rules/reader-election.js';

const claim = (overrides: Partial<ReaderClaim> = {}): ReaderClaim => ({
  generation: 1,
  pid: 42,
  startedAt: 1_756_700_000_000,
  at: 1_756_700_000_000,
  ...overrides,
});

describe('readerIsStale', () => {
  it('is stale once a dead pid holds it', () => {
    expect(readerIsStale(claim(), false, null, claim().at)).toBe(true);
  });

  it('keeps the claim where the process table could not be asked', () => {
    expect(readerIsStale(claim(), null, null, claim().at + READER_STALE_MS)).toBe(false);
  });

  it('is stale where a live pid started outside the skew bound of the claim', () => {
    const held = claim({ startedAt: 1_756_700_000_000 });
    const liveStart = held.startedAt! + READER_LOCK_SKEW_MS;
    expect(readerIsStale(held, true, liveStart, held.at)).toBe(true);
  });

  it('keeps a reused-pid read inside the skew bound as the same live process', () => {
    const held = claim({ startedAt: 1_756_700_000_000 });
    // `ps -o lstart=`'s whole-second resolution against a self-stamped
    // millisecond `startedAt` — the 591ms mismatch this rule is built to tolerate.
    const liveStart = held.startedAt! + 591;
    expect(readerIsStale(held, true, liveStart, held.at)).toBe(false);
  });

  it('is stale once a live, correctly-identified holder goes older than the bound', () => {
    const held = claim({ at: 1_756_700_000_000 });
    expect(readerIsStale(held, true, held.startedAt, held.at + READER_STALE_MS)).toBe(true);
    expect(readerIsStale(held, true, held.startedAt, held.at + READER_STALE_MS - 1)).toBe(false);
  });

  it('skips the skew check where either startedAt is unreadable', () => {
    const held = claim({ startedAt: null });
    expect(readerIsStale(held, true, 1_756_700_000_000, held.at)).toBe(false);
    const liveUnknown = claim({ startedAt: 1_756_700_000_000 });
    expect(readerIsStale(liveUnknown, true, null, liveUnknown.at)).toBe(false);
  });
});

describe('electReader', () => {
  it('answers unknown where the lock could not be read', () => {
    expect(electReader(null, false, 42, true, 1, 1)).toBe('unknown');
  });

  it('elects where no holder exists', () => {
    expect(electReader(null, true, 42, true, 1, 1)).toBe('elect');
  });

  it('elects where this process already holds it', () => {
    const held = claim({ pid: 42 });
    expect(electReader(held, true, 42, true, held.startedAt, held.at)).toBe('elect');
  });

  it('follows a live other holder', () => {
    const held = claim({ pid: 99 });
    expect(electReader(held, true, 42, true, held.startedAt, held.at)).toBe('follow');
  });

  it('elects over a dead holder', () => {
    const held = claim({ pid: 99 });
    expect(electReader(held, true, 42, false, null, held.at)).toBe('elect');
  });

  it('elects over a holder that reads stale on age alone', () => {
    const held = claim({ pid: 99, at: 1_756_700_000_000 });
    expect(electReader(held, true, 42, true, held.startedAt, held.at + READER_STALE_MS)).toBe('elect');
  });

  it('elects over a reused pid outside the skew bound, read as stale', () => {
    const held = claim({ pid: 99, startedAt: 1_756_700_000_000 });
    const liveStart = held.startedAt! + READER_LOCK_SKEW_MS;
    expect(electReader(held, true, 42, true, liveStart, held.at)).toBe('elect');
  });

  it('follows where the table could not be asked, never electing on "unknown"', () => {
    const held = claim({ pid: 99 });
    expect(electReader(held, true, 42, null, null, held.at)).toBe('follow');
  });
});

describe('heartbeatIsFresh', () => {
  it('is fresh just under two PR ticks old', () => {
    expect(heartbeatIsFresh(1_756_700_000_000, 1_756_700_000_000 + HEARTBEAT_STALE_MS - 1)).toBe(true);
  });

  it('is stale at exactly two PR ticks old', () => {
    expect(heartbeatIsFresh(1_756_700_000_000, 1_756_700_000_000 + HEARTBEAT_STALE_MS)).toBe(false);
  });

  it('is fresh at the instant it was written', () => {
    expect(heartbeatIsFresh(1_756_700_000_000, 1_756_700_000_000)).toBe(true);
  });
});
