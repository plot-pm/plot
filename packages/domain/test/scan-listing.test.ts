import { describe, it, expect } from 'vitest';

import {
  encodeListingKey, foldPulseListing, foldScanListing, pulseListingVerdict, parseScanListingRows, scanListingRowsOf, readCarriedPrStates, renderListingReport, renderScanListing, scanListingWindowFor,
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


const answer = (over: Partial<ScanListingAnswer> = {}): ScanListingAnswer => ({
  verdict: 'ok',
  rows: [],
  complete: 'whole',
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
    const open = answer({ rows: [row({ state: 'OPEN' })], complete: 'whole' });
    const rest = answer({ rows: [] });
    const folded = foldScanListing(held, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: true });
  });

  it('reads a carried OPEN row as MERGED once the delta reports it merged', () => {
    const held = carried({ rows: [row({ state: 'OPEN' })] });
    const open = answer({ rows: [], complete: 'whole' });
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
    const open = answer({ rows: [], complete: 'whole' });
    const rest = answer({ rows: [] });
    expect(foldScanListing(held, open, rest)).toEqual({ ok: false, refusal: 'open-row-vanished' });
  });

  it('refuses where the open call failed', () => {
    const open = answer({ verdict: 'failed', complete: 'possibly-truncated' });
    const rest = answer({});
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'open-failed' });
  });

  it('refuses where the delta call failed', () => {
    const open = answer({ complete: 'whole' });
    const rest = answer({ verdict: 'failed', complete: 'possibly-truncated' });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'delta-failed' });
  });

  it('refuses where the delta call is partial', () => {
    const open = answer({ complete: 'whole' });
    const rest = answer({ verdict: 'partial', complete: 'possibly-truncated' });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('refuses where a call with rows makes no whole-page claim', () => {
    const open = answer({ rows: [row({ state: 'OPEN' })], complete: 'possibly-truncated' });
    const rest = answer({ complete: 'whole' });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('reports complete: false where the carried listing was never whole, even on a clean fold', () => {
    const held = carried({ complete: false, rows: [] });
    const open = answer({ rows: [row({ state: 'OPEN' })], complete: 'whole' });
    const rest = answer({ rows: [] });
    const folded = foldScanListing(held, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: false });
  });

  it('reports complete: true for a full read whose pages are both whole', () => {
    const open = answer({ rows: [row({ state: 'OPEN' })], complete: 'whole' });
    const rest = answer({ rows: [row({ state: 'OPEN' })] });
    const folded = foldScanListing(null, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: true });
  });

  it('reads an ok page with no rows as whole, since the host owes it no claim', () => {
    const held = carried({ rows: [row({ state: 'MERGED' })] });
    const open = answer({ rows: [], complete: 'possibly-truncated' });
    const rest = answer({ rows: [], complete: 'possibly-truncated' });
    expect(foldScanListing(held, open, rest)).toEqual({ ok: true, rows: [row({ state: 'MERGED' })], complete: true });
  });

  it('refuses a full read whose two pages both hold no rows', () => {
    const open = answer({ rows: [], complete: 'possibly-truncated' });
    const rest = answer({ rows: [], complete: 'possibly-truncated' });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('ranks a branch with rows in both OPEN and non-OPEN state as OPEN', () => {
    const held = carried({ rows: [row({ state: 'CLOSED' })] });
    const open = answer({ rows: [row({ state: 'OPEN' })], complete: 'whole' });
    const rest = answer({ rows: [row({ state: 'CLOSED' })] });
    const folded = foldScanListing(held, open, rest);
    expect(folded).toEqual({ ok: true, rows: [row({ state: 'OPEN' })], complete: true });
  });

  it('refuses a Bitbucket window answer with real rows and no whole-page notice', () => {
    // THE GAP THIS SLICE CLOSES. `bb_window_listing` already refuses a short
    // page on the shell side, but prints no success notice on its happy path —
    // so a delta with real rows and ordinary stderr reads as an unproven page,
    // exactly like a GitHub answer with no "page complete" line would.
    const open = answer({ rows: [row({ state: 'OPEN' })], complete: 'possibly-truncated' });
    const rest = answer({ rows: [row({ state: 'MERGED' })], complete: 'possibly-truncated' });
    expect(foldScanListing(null, open, rest)).toEqual({ ok: false, refusal: 'no-whole-page-claim' });
  });

  it('accepts a Bitbucket window answer once it carries the window-complete notice', () => {
    const open = answer({ rows: [row({ state: 'OPEN' })], complete: 'whole' });
    const rest = answer({ rows: [row({ state: 'MERGED' })], complete: 'whole' });
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

describe('readCarriedPrStates', () => {
  it('reads back what renderScanListing wrote, keyed by the encoded branch', () => {
    const rendered = renderScanListing([row({ head: 'feature/a_b', state: 'MERGED' }), row({ head: 'bug/c' })], true)!;
    const read = readCarriedPrStates(rendered);
    expect(read?.complete).toBe(true);
    expect([...read!.states]).toEqual([['feature_a__b', 'MERGED'], ['bug_c', 'OPEN']]);
  });

  it('reads an arrived listing that is not whole as incomplete', () => {
    expect(readCarriedPrStates(renderScanListing([row()], false)!)?.complete).toBe(false);
  });

  it('refuses an empty listing and one with no .list-arrived line', () => {
    expect(readCarriedPrStates('')).toBeNull();
    expect(readCarriedPrStates('feature_b1\tOPEN\t-\t-\n.list-complete\t1\t-\t-\n')).toBeNull();
  });

  it('skips dotted notes and lines with no state, and lets a later line win', () => {
    const read = readCarriedPrStates('.branches\t2\t-\t-\nfeature_x\t\t-\t-\nfeature_y\tOPEN\t-\t-\nfeature_y\tMERGED\t-\t-\n.list-arrived\t1\t-\t-\n');
    expect([...read!.states]).toEqual([['feature_y', 'MERGED']]);
  });
});

describe('readCarriedPrStates rows', () => {
  it('keeps checks and draft as written and fills a missing word with a dash', () => {
    const read = readCarriedPrStates('feature_a\tOPEN\tgreen\tfalse\nfeature_b\tMERGED\n.list-arrived\t1\t-\t-\n');
    expect(read!.rows).toEqual([
      { key: 'feature_a', state: 'OPEN', checks: 'green', draft: 'false' },
      { key: 'feature_b', state: 'MERGED', checks: '-', draft: '-' },
    ]);
  });

  it('reads an empty checks or draft word as a dash', () => {
    const read = readCarriedPrStates('feature_a\tOPEN\t\t\n.list-arrived\t1\t-\t-\n');
    expect(read!.rows).toEqual([{ key: 'feature_a', state: 'OPEN', checks: '-', draft: '-' }]);
  });
});

describe('renderListingReport', () => {
  const rows = [
    { key: 'feature_b', state: 'MERGED', checks: '-', draft: '-' },
    { key: 'feature_a', state: 'OPEN', checks: 'green', draft: 'false' },
  ];

  it('prints .branches first, rows in key order, .list-complete, then .list-arrived last', () => {
    expect(renderListingReport(rows, 7, true)).toBe(
      'listing: .branches\t7\t-\t-\n'
      + 'listing: feature_a\tOPEN\tgreen\tfalse\n'
      + 'listing: feature_b\tMERGED\t-\t-\n'
      + 'listing: .list-complete\t1\t-\t-\n'
      + 'listing: .list-arrived\t1\t-\t-\n',
    );
  });

  it('prints a dash for an empty word, and keeps rows with one key in their order', () => {
    const odd = [
      { key: 'feature_c', state: 'OPEN', checks: '', draft: '' },
      { key: 'feature_a', state: 'OPEN', checks: 'green', draft: 'false' },
      { key: 'feature_c', state: 'MERGED', checks: '-', draft: '-' },
    ];
    expect(renderListingReport(odd, 3, false)).toBe(
      'listing: .branches\t3\t-\t-\n'
      + 'listing: feature_a\tOPEN\tgreen\tfalse\n'
      + 'listing: feature_c\tOPEN\t-\t-\n'
      + 'listing: feature_c\tMERGED\t-\t-\n'
      + 'listing: .list-arrived\t1\t-\t-\n',
    );
  });

  it('keeps rows already in key order, and two rows with one key, as they came', () => {
    const ordered = [
      { key: 'feature_a', state: 'OPEN', checks: '-', draft: '-' },
      { key: 'feature_b', state: 'OPEN', checks: '-', draft: '-' },
      { key: 'feature_b', state: 'CLOSED', checks: '-', draft: '-' },
    ];
    expect(renderListingReport(ordered, 2, false).split('\n').slice(1, 4)).toEqual([
      'listing: feature_a\tOPEN\t-\t-',
      'listing: feature_b\tOPEN\t-\t-',
      'listing: feature_b\tCLOSED\t-\t-',
    ]);
  });

  it('omits .list-complete for a cut listing', () => {
    expect(renderListingReport(rows, 2, false)).not.toContain('.list-complete');
  });

  it('round-trips through readCarriedPrStates', () => {
    const text = renderListingReport(rows, 2, true).replaceAll('listing: ', '');
    const read = readCarriedPrStates(text);
    expect(read?.complete).toBe(true);
    expect(read?.rows.map((r) => r.key).sort()).toEqual(['feature_a', 'feature_b']);
  });
});

describe('the scan\'s own listing read', () => {
  const rich = (head: string, state: string, checks = 'green') => JSON.stringify({ number: 1, state, head, draft: false, checks });
  const plain = (head: string, state: string) => JSON.stringify({ number: 2, state, head });
  const ok = (stdout: string, complete: 'whole' | 'possibly-truncated' = 'possibly-truncated') => ({ answer: 'answered' as const, stdout, said: '', complete });

  it('names each refusal by what the host said', () => {
    expect(pulseListingVerdict(ok(''))).toBe('ok');
    expect(pulseListingVerdict({ answer: 'partial', stdout: '', said: 'x', complete: 'possibly-truncated' as const })).toBe('partial');
    expect(pulseListingVerdict({ answer: 'unaskable', stdout: '', said: 'x', complete: 'possibly-truncated' as const })).toBe('unasked');
    expect(pulseListingVerdict({ answer: 'failed', stdout: '', said: 'API rate limit exceeded', complete: 'possibly-truncated' as const })).toBe('throttled');
    expect(pulseListingVerdict({ answer: 'failed', stdout: '', said: 'secondary rate limit', complete: 'possibly-truncated' as const })).toBe('secondary');
    expect(pulseListingVerdict({ answer: 'failed', stdout: '', said: 'gh auth login required', complete: 'possibly-truncated' as const })).toBe('unasked');
    expect(pulseListingVerdict({ answer: 'failed', stdout: '', said: 'HTTP 503', complete: 'possibly-truncated' as const })).toBe('failed');
    expect(pulseListingVerdict({ answer: 'failed', stdout: '', said: '', kind: 'throttled', complete: 'possibly-truncated' as const })).toBe('throttled');
    expect(pulseListingVerdict({ answer: 'failed', stdout: '', said: 'a burst', kind: 'secondary', complete: 'possibly-truncated' as const })).toBe('secondary');
  });

  it('keeps the open row with its rollup, drops the settled OPEN rows, and ranks merged over closed', () => {
    const open = ok([rich('feature/a', 'OPEN'), '{}', 'not json', ''].join('\n'));
    const settled = ok([plain('feature/a', 'OPEN'), plain('feature/b', 'CLOSED'), plain('feature/b', 'MERGED'), plain('feature/b', 'CLOSED')].join('\n'));
    const read = foldPulseListing(open, settled, 9);
    expect(read.verdict).toBe('ok');
    expect(read.listing!.rows).toEqual([
      { key: 'feature_a', state: 'OPEN', checks: 'green', draft: 'false' },
      { key: 'feature_b', state: 'MERGED', checks: '-', draft: '-' },
    ]);
    expect(read.listing!.complete).toBe(true);
  });

  it('licenses completeness by both claims or by the row count, never by a page at its limit', () => {
    const one = (complete: 'whole' | 'possibly-truncated' = 'possibly-truncated') => ok(plain('feature/b', 'MERGED'), complete);
    expect(foldPulseListing(ok(rich('feature/a', 'OPEN')), one(), 1).listing!.complete).toBe(false);
    expect(foldPulseListing(ok(rich('feature/a', 'OPEN'), 'whole'), one('whole'), 1).listing!.complete).toBe(true);
    expect(foldPulseListing(ok(rich('feature/a', 'OPEN')), one('whole'), 1).listing!.complete).toBe(false);
    expect(foldPulseListing(ok(''), ok(''), 9).listing!.complete).toBe(false);
    expect(foldPulseListing(ok('', 'whole'), ok('', 'whole'), 9).listing!.complete).toBe(true);
  });

  it('keeps the rows of a partial answer but never calls it complete', () => {
    const read = foldPulseListing({ answer: 'partial', stdout: rich('feature/a', 'OPEN'), said: 'one state failed', complete: 'possibly-truncated' as const }, ok(plain('feature/b', 'MERGED')), 9);
    expect(read.verdict).toBe('partial');
    expect(read.listing!.states.get('feature_a')).toBe('OPEN');
    expect(read.listing!.complete).toBe(false);
  });

  it('yields no listing and the worse verdict where a call is refused, with what that call said', () => {
    const refused = foldPulseListing({ answer: 'failed', stdout: '', said: 'API rate limit exceeded', complete: 'possibly-truncated' as const }, null, 9);
    expect(refused).toEqual({ verdict: 'throttled', listing: null, said: 'API rate limit exceeded' });
    const second = foldPulseListing(ok(rich('feature/a', 'OPEN')), { answer: 'failed', stdout: '', said: 'HTTP 503', complete: 'possibly-truncated' as const }, 9);
    expect(second).toEqual({ verdict: 'failed', listing: null, said: 'HTTP 503' });
    expect(foldPulseListing(ok(''), null, 9)).toEqual({ verdict: 'ok', listing: null, said: '' });
  });
});

describe('scanListingRowsOf', () => {
  it('reads listed rows as the stdout parser does, and refuses a row with no head', () => {
    expect(scanListingRowsOf([{ head: 'feature/a', state: 'OPEN', checks: 'green', draft: true }]))
      .toEqual([{ head: 'feature/a', state: 'OPEN', updatedAt: '', checks: 'green', draft: true }]);
    expect(scanListingRowsOf([{ state: 'OPEN' }])).toBeNull();
    expect(parseScanListingRows('null')).toBeNull();
  });
});
