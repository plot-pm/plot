import { describe, it, expect } from 'vitest';

import {
  encodeListingKey, foldScanListing, parseScanListingRows, renderScanListing, scanListingWindowFor,
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
const WINDOW_WHOLE = (state: string, matches: number) =>
  whole(`bitbucket pr-list state=${state} window complete (${matches} matches, every page read) — this window holds every pull request the host has in this state since the stamp`);

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

  it('skips a row whose updatedAt does not parse when finding the watermark', () => {
    const held = carried({
      rows: [row({ head: 'a', updatedAt: '' }), row({ head: 'b', updatedAt: '2026-10-26T10:00:00Z' })],
    });
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

  it('refuses where a call with rows makes no whole-page claim', () => {
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: 'plot-host: github pr-list answered' });
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

  it('reports complete: true for a full read whose pages are both whole', () => {
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: OPEN_WHOLE });
    const rest = answer({ rows: [row({ state: 'OPEN' })] });
    const folded = foldScanListing(null, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: true });
  });

  it('reads an ok page with no rows as whole, since the host owes it no claim', () => {
    const held = carried({ rows: [row({ state: 'MERGED' })] });
    const open = answer({ rows: [], stderr: '' });
    const rest = answer({ rows: [], stderr: '' });
    expect(foldScanListing(held, open, rest)).toEqual({ ok: true, rows: [row({ state: 'MERGED' })], complete: true });
  });

  it('refuses a full read whose two pages both hold no rows', () => {
    const open = answer({ rows: [], stderr: '' });
    const rest = answer({ rows: [], stderr: '' });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('ranks a branch with rows in both OPEN and non-OPEN state as OPEN', () => {
    const held = carried({ rows: [row({ state: 'CLOSED' })] });
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: OPEN_WHOLE });
    const rest = answer({ rows: [row({ state: 'CLOSED' })] });
    const folded = foldScanListing(held, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: true });
  });

  it('refuses a Bitbucket window answer with real rows and no whole-page notice', () => {
    // THE GAP THIS SLICE CLOSES. `bb_window_listing` already refuses a short
    // page on the shell side, but prints no success notice on its happy path —
    // so a delta with real rows and ordinary stderr reads as an unproven page,
    // exactly like a GitHub answer with no "page complete" line would.
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: null });
    const rest = answer({ rows: [row({ state: 'MERGED' })], stderr: null });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('accepts a Bitbucket window answer once it carries the window-complete notice', () => {
    const open = answer({ rows: [row({ state: 'OPEN' })], stderr: WINDOW_WHOLE('open', 1) });
    const rest = answer({ rows: [row({ state: 'MERGED' })], stderr: WINDOW_WHOLE('all', 1) });
    const folded = foldScanListing(null, open, rest);
    expect(folded.ok).toBe(true);
  });
});

describe('parseScanListingRows', () => {
  it('reads head, and checks and draft from a rich row only', () => {
    const rich = JSON.stringify({ number: 1, state: 'OPEN', head: 'feature/a', draft: false, checks: 'green', updatedAt: '2026-10-26T10:00:00Z' });
    const plain = JSON.stringify({ number: 2, state: 'MERGED', head: 'feature/b', draft: false, url: 'u', updatedAt: '2026-10-25T10:00:00Z' });
    expect(parseScanListingRows(`${rich}\n${plain}\n`)).toEqual([
      { head: 'feature/a', state: 'OPEN', updatedAt: '2026-10-26T10:00:00Z', checks: 'green', draft: false },
      { head: 'feature/b', state: 'MERGED', updatedAt: '2026-10-25T10:00:00Z' },
    ]);
  });

  it('refuses a row that carries headRefName rather than head', () => {
    expect(parseScanListingRows(JSON.stringify({ state: 'OPEN', headRefName: 'feature/a', updatedAt: 'x' }))).toBeNull();
  });

  it('refuses a line that is not JSON', () => {
    expect(parseScanListingRows('plot-host: something went wrong\n')).toBeNull();
  });

  it('refuses a line whose JSON is null or a scalar', () => {
    expect(parseScanListingRows('null\n')).toBeNull();
    expect(parseScanListingRows('5\n')).toBeNull();
    expect(parseScanListingRows('"text"\n')).toBeNull();
  });

  it('refuses a row whose head or state is missing, empty or not a string', () => {
    expect(parseScanListingRows(JSON.stringify({ head: '', state: 'OPEN' }))).toBeNull();
    expect(parseScanListingRows(JSON.stringify({ head: 7, state: 'OPEN' }))).toBeNull();
    expect(parseScanListingRows(JSON.stringify({ head: 'feature/a' }))).toBeNull();
    expect(parseScanListingRows(JSON.stringify({ head: 'feature/a', state: '' }))).toBeNull();
  });

  it('reads an absent updatedAt as the empty string and skips blank lines', () => {
    expect(parseScanListingRows(`\n${JSON.stringify({ head: 'feature/a', state: 'OPEN' })}\n  \n`)).toEqual([
      { head: 'feature/a', state: 'OPEN', updatedAt: '' },
    ]);
  });

  it('keeps checks without a draft where draft is not a boolean', () => {
    expect(parseScanListingRows(JSON.stringify({ head: 'feature/a', state: 'OPEN', checks: 'green', draft: 'yes' }))).toEqual([
      { head: 'feature/a', state: 'OPEN', updatedAt: '', checks: 'green' },
    ]);
  });
});

describe('renderScanListing', () => {
  it('writes four fields per line, `-` for absent checks and draft, and .list-arrived last', () => {
    const rendered = renderScanListing([
      row({ head: 'feature/a_b', state: 'OPEN', checks: 'green', draft: false }),
      row({ head: 'feature/c', state: 'MERGED' }),
    ], true);
    expect(rendered).toBe([
      'feature_a__b\tOPEN\tgreen\tfalse',
      'feature_c\tMERGED\t-\t-',
      '.branches\t2\t-\t-',
      '.list-complete\t1\t-\t-',
      '.list-arrived\t1\t-\t-',
      '',
    ].join('\n'));
  });

  it('omits .list-complete where the listing is not whole', () => {
    expect(renderScanListing([row({ head: 'feature/c', state: 'MERGED' })], false)).toBe([
      'feature_c\tMERGED\t-\t-',
      '.branches\t1\t-\t-',
      '.list-arrived\t1\t-\t-',
      '',
    ].join('\n'));
  });

  it('refuses rather than throws where a row has no head', () => {
    const headless = { state: 'OPEN', updatedAt: '2026-10-26T10:00:00Z' } as unknown as ScanListingRow;
    expect(renderScanListing([headless], true)).toBeNull();
    expect(encodeListingKey(undefined)).toBeNull();
  });
});
