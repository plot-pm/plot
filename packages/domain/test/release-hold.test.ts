import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { PrIndexRow } from '../src/entities/pr-index.js';
import type { ReleaseHoldRecord } from '../src/entities/release-hold.js';
import { releaseHoldAt } from '../src/adapters/release-hold/release-hold-file.js';
import { releaseHold } from '../src/rules/release-hold.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-11-26T20:40:00Z');
const BOUND = 3_600_000;

const release = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 3719,
  head: 'changeset-release/main',
  base: 'main',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'green',
  plotReview: 'pending',
  plotReviewSha: HEAD,
  ...over,
});

const judged = (state: 'success' | 'failure', over: Partial<PrIndexRow> = {}): PrIndexRow =>
  release({ plotReview: state, plotReviewJudged: state, plotReviewCheckedSha: HEAD, ...over });

const record = (over: Partial<ReleaseHoldRecord> = {}): ReleaseHoldRecord => ({
  v: 1,
  head: HEAD,
  since: new Date(NOW - 60_000).toISOString(),
  ...over,
});

const ask = (row: PrIndexRow | null, rec: ReleaseHoldRecord | null = null, now = NOW) => releaseHold(row, rec, now, BOUND, 'main');

describe('releaseHold', () => {
  it('holds a green head with a trusted success review, beginning at now with no record', () => {
    expect(ask(judged('success'))).toEqual({ verdict: 'holds', pr: 3719, head: HEAD, since: new Date(NOW).toISOString() });
  });

  it('holds a green head whose review is pending on the head', () => {
    expect(ask(release())).toMatchObject({ verdict: 'holds', head: HEAD });
  });

  it('does not hold an absent, failed or unchecked review', () => {
    expect(ask(release({ plotReview: 'absent' }))).toEqual({ verdict: 'none', reason: 'review-not-on-head' });
    expect(ask(judged('failure'))).toEqual({ verdict: 'none', reason: 'review-not-on-head' });
    expect(ask(release({ plotReview: 'success' }))).toEqual({ verdict: 'none', reason: 'review-not-on-head' });
  });

  it('does not hold a review that names an older head', () => {
    expect(ask(release({ plotReviewSha: OLD }))).toEqual({ verdict: 'none', reason: 'review-not-on-head' });
  });

  it('does not hold CI that is not counted-green on the head', () => {
    expect(ask(release({ ciChecks: 'pending' }))).toEqual({ verdict: 'none', reason: 'ci-not-counted' });
    expect(ask(release({ ciChecks: 'none' }))).toEqual({ verdict: 'none', reason: 'ci-not-counted' });
    expect(ask(release({ checksSha: OLD }))).toEqual({ verdict: 'none', reason: 'ci-not-counted' });
    expect(ask(release({ ciChecks: undefined }))).toEqual({ verdict: 'none', reason: 'ci-not-counted' });
  });

  it('ends when the release row is MERGED or closed, and holds nothing with no row', () => {
    expect(ask(release({ state: 'MERGED' }), record())).toEqual({ verdict: 'none', reason: 'not-open' });
    expect(ask(release({ state: 'CLOSED' }), record())).toEqual({ verdict: 'none', reason: 'not-open' });
    expect(ask(null, record())).toEqual({ verdict: 'none', reason: 'no-release' });
  });

  it('holds only a changeset-release/ row into the default branch', () => {
    expect(ask(release({ head: 'feature/x' }))).toEqual({ verdict: 'none', reason: 'not-release-branch' });
    expect(ask(release({ base: 'sprint/x' }))).toEqual({ verdict: 'none', reason: 'base-not-default' });
    expect(ask(release({ base: undefined }))).toEqual({ verdict: 'none', reason: 'base-not-default' });
    expect(releaseHold(release(), null, NOW, BOUND, '')).toEqual({ verdict: 'none', reason: 'base-not-default' });
  });

  it('keeps the since of the record that names the head', () => {
    expect(ask(release(), record())).toEqual({ verdict: 'holds', pr: 3719, head: HEAD, since: record().since });
  });

  it('ends past the bound', () => {
    const since = new Date(NOW - BOUND).toISOString();
    expect(ask(release(), record({ since }))).toEqual({ verdict: 'none', reason: 'expired' });
    expect(ask(release(), record({ since: new Date(NOW - BOUND + 1).toISOString() }))).toMatchObject({ verdict: 'holds' });
  });

  it('does not hold an expired head again on a later pass', () => {
    const rec = record({ since: new Date(NOW - BOUND - 1).toISOString() });
    expect(ask(release(), rec)).toEqual({ verdict: 'none', reason: 'expired' });
    expect(ask(release(), rec, NOW + 60_000)).toEqual({ verdict: 'none', reason: 'expired' });
  });

  it('starts a new hold for a new head, though the old head expired', () => {
    const rec = record({ head: OLD, since: new Date(NOW - 2 * BOUND).toISOString() });
    expect(ask(release(), rec)).toEqual({ verdict: 'holds', pr: 3719, head: HEAD, since: new Date(NOW).toISOString() });
  });

  it('ends on a lift for this head', () => {
    expect(ask(release(), record({ liftedBy: 'jwloka' }))).toEqual({ verdict: 'none', reason: 'lifted' });
  });

  it('does not lift this head on a lift for another head', () => {
    expect(ask(release(), record({ head: OLD, liftedBy: 'jwloka' }))).toMatchObject({ verdict: 'holds', head: HEAD });
  });

  it('holds nothing on a since that does not parse', () => {
    expect(ask(release(), record({ since: 'garbled' }))).toEqual({ verdict: 'none', reason: 'since-unparseable' });
  });
});

describe('releaseHoldAt', () => {
  const dirs: string[] = [];
  const file = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'release-hold-'));
    dirs.push(dir);
    return join(dir, '.plot', 'state', 'release-hold.json');
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reads no file as null', async () => {
    expect(await releaseHoldAt(file()).read()).toEqual({ ok: true, value: null });
  });

  it('writes whole and reads back', async () => {
    const path = file();
    const store = releaseHoldAt(path);
    expect((await store.write(record())).ok).toBe(true);
    expect(await store.read()).toEqual({ ok: true, value: record() });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(record());
  });

  it('reads an unparseable or other-version file as null', async () => {
    const path = file();
    const store = releaseHoldAt(path);
    await store.write(record());
    writeFileSync(path, '{not json');
    expect(await store.read()).toEqual({ ok: true, value: null });
    writeFileSync(path, JSON.stringify({ ...record(), v: 2 }));
    expect(await store.read()).toEqual({ ok: true, value: null });
  });
});
