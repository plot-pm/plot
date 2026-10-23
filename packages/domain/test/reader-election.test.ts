import { describe, expect, it } from 'vitest';

import {
  READER_STALE_MS,
  electReader,
  readerIsStale,
  type ReaderClaim,
} from '../src/rules/reader-election.js';

const NOW = 1_756_700_000_000;

const claimAt = (at: number, pid = 4242, startedAt: number | null = null): ReaderClaim => ({
  pid,
  startedAt,
  at,
});

describe('readerIsStale', () => {
  it('frees a claim whose process is gone', () => {
    expect(readerIsStale(claimAt(NOW), false, null, NOW)).toBe(true);
  });

  it('keeps a claim a live process holds', () => {
    expect(readerIsStale(claimAt(NOW), true, null, NOW)).toBe(false);
  });

  it('keeps a claim where the process table could not be asked', () => {
    // Reclaiming on "unknown" would elect a second reader on the strength of
    // not knowing — exactly the double-read this mechanism exists to prevent.
    expect(readerIsStale(claimAt(NOW), null, null, NOW)).toBe(false);
  });

  it('frees a claim whose pid was reused by a different process', () => {
    const claim = claimAt(NOW, 4242, NOW - 60_000);
    expect(readerIsStale(claim, true, NOW - 10_000, NOW)).toBe(true);
  });

  it('keeps a claim whose live process is the one that claimed it', () => {
    const claim = claimAt(NOW, 4242, NOW - 60_000);
    expect(readerIsStale(claim, true, NOW - 60_000, NOW)).toBe(false);
  });

  it('frees a live claim only once it is older than the staleness bound', () => {
    const claim = claimAt(NOW - READER_STALE_MS + 1);
    expect(readerIsStale(claim, true, null, NOW)).toBe(false);
    expect(readerIsStale(claimAt(NOW - READER_STALE_MS), true, null, NOW)).toBe(true);
  });

  it('bounds staleness well above the refresh cadence', () => {
    // The refresh cadence is on the order of a minute; a shorter bound would
    // reclaim a live reader's own claim between two of its renewals.
    expect(READER_STALE_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });
});

describe('electReader', () => {
  it('elects where no lock could be read', () => {
    expect(electReader(null, false, 11, null, null, NOW)).toBe('unknown');
  });

  it('elects where the lock names no holder', () => {
    expect(electReader(null, true, 11, null, null, NOW)).toBe('elect');
  });

  it('elects where this process already holds the lock', () => {
    const held = claimAt(NOW, 11);
    expect(electReader(held, true, 11, true, null, NOW)).toBe('elect');
  });

  it('follows a live holder that is not this process', () => {
    const held = claimAt(NOW, 99);
    expect(electReader(held, true, 11, true, null, NOW)).toBe('follow');
  });

  it('elects over a holder whose process is gone', () => {
    const held = claimAt(NOW, 99);
    expect(electReader(held, true, 11, false, null, NOW)).toBe('elect');
  });

  it('elects over a holder old enough to be stale', () => {
    const held = claimAt(NOW - READER_STALE_MS, 99);
    expect(electReader(held, true, 11, true, null, NOW)).toBe('elect');
  });

  it('follows rather than electing on an unreadable holder liveness', () => {
    const held = claimAt(NOW, 99);
    expect(electReader(held, true, 11, null, null, NOW)).toBe('follow');
  });
});
