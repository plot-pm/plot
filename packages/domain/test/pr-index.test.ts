import { describe, it, expect } from 'vitest';

import {
  decodePrIndex,
  encodePrIndex,
  PR_INDEX_VERSION,
  type PrIndex,
  type PrIndexRow,
} from '../src/entities/pr-index.js';
import { foldPrIndex, watermarkOf } from '../src/rules/pr-index.js';

/**
 * A row carrying only what every host answers, so a test adding an optional
 * field is visibly adding it.
 */
const row = (number: number, over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number,
  head: `feature/b${number}`,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: `https://example.invalid/${number}`,
  ...over,
});

const store = (rows: readonly PrIndexRow[], over: Partial<PrIndex> = {}): PrIndex => ({
  v: PR_INDEX_VERSION,
  connector: 'github',
  watermark: null,
  complete: true,
  at: '2026-09-21T10:00:00Z',
  rows: [...rows],
  ...over,
});

describe('the watermark is the host\'s newest stamp', () => {
  // THE DONE-WHEN THIS FILE EXISTS FOR. The skew bug the design names: a PR
  // updated at 18:42:10 host-time, read by a client whose clock says 18:42:12,
  // is excluded by every later `updated:>18:42:12` — forever, silently, because
  // the window never reopens. The fixture clock is deliberately AHEAD of the
  // fixture data, which is what makes a `Date.now()` implementation fail here.
  it('takes the newest updatedAt in the rows, never the local clock', () => {
    const aheadOfTheData = '2026-09-21T18:42:12Z';
    const folded = foldPrIndex(null, {
      connector: 'github',
      complete: true,
      at: aheadOfTheData,
      rows: [
        row(1, { updatedAt: '2026-09-21T18:42:10Z' }),
        row(2, { updatedAt: '2026-09-21T17:00:00Z' }),
      ],
    });
    expect(folded.watermark).toBe('2026-09-21T18:42:10Z');
    expect(folded.watermark).not.toBe(aheadOfTheData);
  });

  it('is null where no row carries a stamp, rather than an epoch', () => {
    // A zero would reopen a window back to 1970 on every refresh — the whole
    // history, every minute, which is the cost this plan exists to remove.
    expect(watermarkOf([row(1), row(2)])).toBeNull();
    expect(foldPrIndex(null, {
      connector: 'github', complete: true, at: '2026-09-21T10:00:00Z', rows: [row(1)],
    }).watermark).toBeNull();
  });

  it('ignores a row whose stamp is empty', () => {
    expect(watermarkOf([row(1, { updatedAt: '' }), row(2, { updatedAt: '2026-01-01T00:00:00Z' })]))
      .toBe('2026-01-01T00:00:00Z');
  });

  it('is recomputed from the merged rows, so a merge can advance it', () => {
    const held = store([row(1, { updatedAt: '2026-09-01T00:00:00Z' })], {
      watermark: '2026-09-01T00:00:00Z',
    });
    const folded = foldPrIndex(held, {
      connector: 'github',
      complete: false,
      at: '2026-09-21T10:00:00Z',
      rows: [row(2, { updatedAt: '2026-09-20T00:00:00Z' })],
    });
    expect(folded.watermark).toBe('2026-09-20T00:00:00Z');
  });
});

describe('a partial answer merges and a whole one replaces', () => {
  // THE DONE-WHEN: catches a whole-store write that deletes every PR belonging
  // to a state that did not answer. Bitbucket has no `all` state, so its arm
  // asks once per state and may reach some and not others.
  it('keeps rows the partial answer did not mention', () => {
    const held = store([row(1), row(2)]);
    const folded = foldPrIndex(held, {
      connector: 'bitbucket',
      complete: false,
      at: '2026-09-21T11:00:00Z',
      rows: [row(2, { state: 'MERGED' })],
    });
    expect(folded.rows.map((r) => r.number)).toEqual([1, 2]);
    expect(folded.rows.find((r) => r.number === 2)?.state).toBe('MERGED');
  });

  it('drops a row a WHOLE answer no longer lists', () => {
    // The other direction, and it is the one a merge-always implementation
    // fails: a complete read saw every PR the host has, so a row missing from
    // it no longer exists and must not outlive the host's own record.
    const held = store([row(1), row(2)]);
    const folded = foldPrIndex(held, {
      connector: 'github',
      complete: true,
      at: '2026-09-21T11:00:00Z',
      rows: [row(2)],
    });
    expect(folded.rows.map((r) => r.number)).toEqual([2]);
  });

  it('records completeness rather than letting a reader infer it', () => {
    const whole = foldPrIndex(null, {
      connector: 'github', complete: true, at: '2026-09-21T11:00:00Z', rows: [row(1)],
    });
    expect(whole.complete).toBe(true);
    // A partial answer leaves the store partial WHATEVER it merged into: the
    // rows belonging to the state that did not answer are exactly the ones
    // nobody re-read, and a store once proven whole says nothing about them now.
    // Proving it whole is what licenses "asked, and there is no PR".
    const afterPartial = foldPrIndex(whole, {
      connector: 'github', complete: false, at: '2026-09-21T12:00:00Z', rows: [row(2)],
    });
    expect(afterPartial.complete).toBe(false);
    // And a whole answer clears it again.
    expect(foldPrIndex(afterPartial, {
      connector: 'github', complete: true, at: '2026-09-21T13:00:00Z', rows: [row(3)],
    }).complete).toBe(true);
  });
});

describe('the store is keyed by number, never by branch', () => {
  // THE DONE-WHEN: catches branch-keying, which loses the older PR and is the
  // `--limit 1` defect by another route — `plot-pr-merged.sh` measured three
  // branches reported unlanded whose work was on main.
  it('round-trips both PRs of one branch', () => {
    const head = 'feature/reopened';
    const folded = foldPrIndex(null, {
      connector: 'github',
      complete: true,
      at: '2026-09-21T10:00:00Z',
      rows: [
        row(10, { head, state: 'CLOSED' }),
        row(11, { head, state: 'OPEN' }),
      ],
    });
    expect(folded.rows).toHaveLength(2);
    expect(folded.rows.map((r) => r.number)).toEqual([10, 11]);
    expect(folded.rows.every((r) => r.head === head)).toBe(true);
  });

  it('survives the file round trip with both intact', () => {
    const head = 'feature/reopened';
    const written = encodePrIndex(foldPrIndex(null, {
      connector: 'github',
      complete: true,
      at: '2026-09-21T10:00:00Z',
      rows: [row(10, { head, state: 'CLOSED' }), row(11, { head, state: 'OPEN' })],
    }));
    const read = decodePrIndex(written);
    expect(read?.rows.map((r) => [r.number, r.state])).toEqual([[10, 'CLOSED'], [11, 'OPEN']]);
  });
});

describe('an unasked field is absent, not false', () => {
  // THE DONE-WHEN behind "a cold store produces byte-identical board output".
  // `refreshPrs` normalizes three fields to three DIFFERENT absent values —
  // `url` to "", `mergeable` to "unknown", `failing_checks` to [] — and each
  // says something the others do not. Inventing a fourth manufactures the
  // verdict `an-unasked-host-is-not-an-absent-pr` exists to remove.
  it('round-trips an absent field as absent', () => {
    const sparse = row(1);
    const read = decodePrIndex(encodePrIndex(store([sparse])));
    const back = read?.rows[0];
    expect(back).toBeDefined();
    expect('mergeable' in (back as object)).toBe(false);
    expect('failing_checks' in (back as object)).toBe(false);
    expect('updatedAt' in (back as object)).toBe(false);
  });

  it('round-trips each of the three absent-value shapes unchanged', () => {
    const explicit = row(1, { url: '', mergeable: 'unknown', failing_checks: [] });
    const back = decodePrIndex(encodePrIndex(store([explicit])))?.rows[0];
    expect(back?.url).toBe('');
    expect(back?.mergeable).toBe('unknown');
    expect(back?.failing_checks).toEqual([]);
  });
});

describe('an unreadable store is nothing to start from', () => {
  // THE DONE-WHEN: an unrecognised `v` falls back to a full read and does not
  // throw. A reader that only tolerated the version it was written against
  // would make the NEXT schema change take the board down rather than cost it
  // one read.
  it('reads an unrecognised version as null', () => {
    const future = JSON.stringify({ ...store([row(1)]), v: PR_INDEX_VERSION + 1 });
    expect(() => decodePrIndex(future)).not.toThrow();
    expect(decodePrIndex(future)).toBeNull();
  });

  it('reads unparseable JSON, an empty file and a foreign shape as null', () => {
    expect(decodePrIndex('{not json')).toBeNull();
    expect(decodePrIndex('')).toBeNull();
    expect(decodePrIndex('   ')).toBeNull();
    expect(decodePrIndex('{"hello":"world"}')).toBeNull();
    // A row whose shape changed takes the whole file down to null, deliberately:
    // a store half this Plot understands is one whose completeness flag it
    // cannot trust, and a full read costs time where a half-read costs answers.
    expect(decodePrIndex(JSON.stringify(store([{ number: 1 } as unknown as PrIndexRow])))).toBeNull();
  });

  it('refuses a field the schema does not name', () => {
    // `.strict()` rather than a passthrough: a field this Plot does not know is
    // one a future Plot wrote, and reading around it would let two versions
    // disagree about what a row means while both parsed it.
    const extra = JSON.stringify(store([{ ...row(1), invented: true } as unknown as PrIndexRow]));
    expect(decodePrIndex(extra)).toBeNull();
  });
});

describe('the encoding', () => {
  it('sorts rows by number, so two runs over one answer produce one file', () => {
    const folded = foldPrIndex(null, {
      connector: 'github',
      complete: true,
      at: '2026-09-21T10:00:00Z',
      rows: [row(3), row(1), row(2)],
    });
    expect(folded.rows.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it('round-trips a whole store unchanged', () => {
    const original = foldPrIndex(null, {
      connector: 'github',
      complete: true,
      at: '2026-09-21T10:00:00Z',
      rows: [row(1, { updatedAt: '2026-09-20T00:00:00Z', mergeable: 'mergeable' })],
    });
    expect(decodePrIndex(encodePrIndex(original))).toEqual(original);
  });
});
