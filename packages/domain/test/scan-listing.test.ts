import { describe, it, expect } from 'vitest';

import {
  foldScanListing, scanListingWindowFor,
  type CarriedListing, type ScanListingAnswer, type ScanListingRow,
} from '../src/rules/scan-listing.js';

const FULL_READ_MS = 24 * 60 * 60 * 1000;

const row = (over: Partial<ScanListingRow> = {}): ScanListingRow => ({
  head: 'feature/b1',
  state: 'OPEN',
  updatedAt: '2026-10-26T10:00:00Z',
  ...over,
});

const carried = (over: Partial<CarriedListing> = {}): CarriedListing => ({
  rows: [row()],
  complete: true,
  fullReadAt: Date.parse('2026-10-26T10:00:00Z'),
  ...over,
});

const whole = (text: string): string => `plot-host: ${text}`;
const OPEN_WHOLE = whole('github pr-list state=open page complete (1 rows below requested limit 500) — this page holds every pull request the host has in this state');
const ALL_WHOLE = whole('github pr-list state=all page complete (1 rows below requested limit 500) — this page holds every pull request the host has in this state');

const answer = (over: Partial<ScanListingAnswer> = {}): ScanListingAnswer => ({
  verdict: 'ok',
  rows: [],
  stderr: ALL_WHOLE,
  ...over,
});

describe('scanListingWindowFor', () => {
  it('answers full with no carried listing', () => {
    expect(scanListingWindowFor(null, Date.parse('2026-10-26T11:00:00Z'), FULL_READ_MS))
      .toEqual({ kind: 'full' });
  });

  it('answers full where the carried listing is not complete', () => {
    const held = carried({ complete: false });
    expect(scanListingWindowFor(held, Date.parse('2026-10-26T11:00:00Z'), FULL_READ_MS))
      .toEqual({ kind: 'full' });
  });

  it('answers full where the carried listing has no rows to derive a watermark from', () => {
    const held = carried({ rows: [] });
    expect(scanListingWindowFor(held, Date.parse('2026-10-26T11:00:00Z'), FULL_READ_MS))
      .toEqual({ kind: 'full' });
  });

  it('answers full where the last full read is missing', () => {
    const held = carried({ fullReadAt: null });
    expect(scanListingWindowFor(held, Date.parse('2026-10-26T11:00:00Z'), FULL_READ_MS))
      .toEqual({ kind: 'full' });
  });

  it('answers full where the last full read is older than fullReadMs', () => {
    const held = carried({ fullReadAt: Date.parse('2026-10-25T00:00:00Z') });
    expect(scanListingWindowFor(held, Date.parse('2026-10-26T11:00:00Z'), FULL_READ_MS))
      .toEqual({ kind: 'full' });
  });

  it('answers delta with since = newest row updatedAt minus 60s, otherwise', () => {
    const held = carried({ rows: [row({ updatedAt: '2026-10-26T10:00:00Z' })] });
    expect(scanListingWindowFor(held, Date.parse('2026-10-26T11:00:00Z'), FULL_READ_MS))
      .toEqual({ kind: 'delta', since: '2026-10-26T09:59:00Z' });
  });

  it('takes the newest updatedAt among several rows', () => {
    const held = carried({
      rows: [
        row({ head: 'a', updatedAt: '2026-10-26T09:00:00Z' }),
        row({ head: 'b', updatedAt: '2026-10-26T10:00:00Z' }),
        row({ head: 'c', updatedAt: '2026-10-26T08:00:00Z' }),
      ],
    });
    expect(scanListingWindowFor(held, Date.parse('2026-10-26T11:00:00Z'), FULL_READ_MS))
      .toEqual({ kind: 'delta', since: '2026-10-26T09:59:00Z' });
  });
});

describe('foldScanListing', () => {
  it('keeps OPEN where a reused branch name carries an OPEN row and an older MERGED row', () => {
    const held = carried({ rows: [row({ state: 'MERGED' })] });
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: OPEN_WHOLE });
    const rest = answer({ rows: [] });
    const folded = foldScanListing(held, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: true });
  });

  it('reads a carried OPEN row as MERGED once the delta reports it merged', () => {
    const held = carried({ rows: [row({ state: 'OPEN' })] });
    const open = answer({ rows: [], stderr: OPEN_WHOLE });
    const rest = answer({ rows: [row({ state: 'MERGED', updatedAt: '2026-10-26T10:30:00Z' })] });
    const folded = foldScanListing(held, open, rest);
    expect(folded).toEqual({
      ok: true,
      rows: [row({ state: 'MERGED', updatedAt: '2026-10-26T10:30:00Z' })],
      complete: true,
    });
  });

  it('refuses where a carried OPEN row appears in neither new answer', () => {
    const held = carried({ rows: [row({ state: 'OPEN' })] });
    const open = answer({ rows: [], stderr: OPEN_WHOLE });
    const rest = answer({ rows: [] });
    expect(foldScanListing(held, open, rest)).toEqual({ ok: false, refusal: 'open-row-vanished' });
  });

  it('refuses where the open call failed', () => {
    const open = answer({ verdict: 'failed', stderr: null });
    const rest = answer({});
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'open-failed' });
  });

  it('refuses where the delta call failed', () => {
    const open = answer({ stderr: OPEN_WHOLE });
    const rest = answer({ verdict: 'failed', stderr: null });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'delta-failed' });
  });

  it('refuses where the delta call is partial', () => {
    const open = answer({ stderr: OPEN_WHOLE });
    const rest = answer({ verdict: 'partial', stderr: 'plot-host: github secondary rate limit' });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('refuses where a call makes no whole-page claim', () => {
    const open = answer({ stderr: 'plot-host: github pr-list answered' });
    const rest = answer({ stderr: ALL_WHOLE });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('reports complete: false where the carried listing was never whole, even on a clean fold', () => {
    const held = carried({ complete: false, rows: [] });
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: OPEN_WHOLE });
    const rest = answer({ rows: [] });
    const folded = foldScanListing(held, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: false });
  });

  it('reports complete: false with no carried listing at all (a full read)', () => {
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: OPEN_WHOLE });
    const rest = answer({ rows: [] });
    const folded = foldScanListing(null, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: false });
  });

  it('ranks a branch with rows in both OPEN and non-OPEN state as OPEN', () => {
    const held = carried({ rows: [row({ state: 'CLOSED' })] });
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: OPEN_WHOLE });
    const rest = answer({ rows: [row({ state: 'CLOSED' })] });
    const folded = foldScanListing(held, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: true });
  });
});
