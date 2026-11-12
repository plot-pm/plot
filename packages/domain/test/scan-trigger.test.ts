import { describe, expect, it } from 'vitest';

import { deskReadsOf, indexChange, listingChange, scanTrigger, type PrIndexRow, type ScanTriggerInput, type StaleReading } from '../src/index.js';

const input = (over: Partial<ScanTriggerInput> = {}): ScanTriggerInput => ({
  watched: true,
  pending: [],
  remotePending: false,
  armed: 3,
  wanted: 3,
  safetyNetDue: false,
  ...over,
});

describe('scanTrigger', () => {
  it('starts nothing on an empty pending set, an intact watch and no due safety net', () => {
    expect(scanTrigger(input())).toEqual({ run: false });
  });

  it('reads every reading and fetches on a due safety net', () => {
    expect(scanTrigger(input({ safetyNetDue: true }))).toEqual({ run: true, reason: 'safety-net', fetch: true, listing: true, readings: 'all' });
  });

  it('reads every reading and fetches while one watch is degraded', () => {
    expect(scanTrigger(input({ armed: 2 }))).toMatchObject({ run: true, reason: 'degraded', fetch: true, readings: 'all' });
  });

  it('reads every beat where fleetd arms no watch set', () => {
    expect(scanTrigger(input({ watched: false, armed: 0, wanted: 0 }))).toMatchObject({ run: true, reason: 'unwatched', readings: 'all' });
  });

  it('reads the named readings, fetches only for a remote change and lists only for prs', () => {
    const pending: StaleReading[] = [{ key: 'prs' }];
    expect(scanTrigger(input({ pending }))).toEqual({ run: true, reason: 'pending', fetch: false, listing: true, readings: pending });
    const config: StaleReading[] = [{ key: 'config' }];
    expect(scanTrigger(input({ pending: config }))).toMatchObject({ fetch: false, listing: false, readings: config });
    expect(scanTrigger(input({ pending: config, remotePending: true }))).toMatchObject({ fetch: true });
  });
});

const listing = (...rows: string[]): string => `${rows.map((row) => `${row}\n`).join('')}.list-complete\n.list-arrived\n`;

describe('listingChange', () => {
  const held = listing('feature/a\tOPEN\tgreen\t-', 'feature/b\tOPEN\tpending\t-');

  it('names remote for a branch that appeared', () => {
    expect(listingChange(held, listing('feature/a\tOPEN\tgreen\t-', 'feature/b\tOPEN\tpending\t-', 'feature/c\tOPEN\t-\t-'))).toEqual({ remote: true, prs: true });
  });

  it('names remote for a branch that went away', () => {
    expect(listingChange(held, listing('feature/a\tOPEN\tgreen\t-')).remote).toBe(true);
  });

  it('names remote for a PR that newly reads MERGED', () => {
    expect(listingChange(held, listing('feature/a\tMERGED\tgreen\t-', 'feature/b\tOPEN\tpending\t-')).remote).toBe(true);
  });

  it('names prs alone for a CI-only change', () => {
    expect(listingChange(held, listing('feature/a\tOPEN\tgreen\t-', 'feature/b\tOPEN\tfailing\t-'))).toEqual({ remote: false, prs: true });
  });

  it('names nothing for an identical listing, an empty held one and an unreadable one', () => {
    expect(listingChange(held, held)).toEqual({ remote: false, prs: false });
    expect(listingChange('', held)).toEqual({ remote: false, prs: false });
    expect(listingChange(held, 'garbage')).toEqual({ remote: false, prs: false });
  });
});

describe('indexChange', () => {
  const row = (head: string, over: Record<string, unknown> = {}): PrIndexRow => ({ head, state: 'OPEN', checks: 'green', draft: false, ...over }) as unknown as PrIndexRow;

  it('names nothing for the same rows', () => {
    expect(indexChange([row('a')], [row('a')])).toEqual({ remote: false, prs: false });
  });

  it('names remote for a merge and for a new head, prs alone for a CI change', () => {
    expect(indexChange([row('a')], [row('a', { state: 'MERGED' })]).remote).toBe(true);
    expect(indexChange([row('a')], [row('a'), row('b')]).remote).toBe(true);
    expect(indexChange([row('a')], [row('a', { checks: 'failing' })])).toEqual({ remote: false, prs: true });
  });
});

describe('deskReadsOf', () => {
  it('reads every desk for a full scan', () => {
    expect(deskReadsOf('all')).toEqual({ status: 'all', unpushed: true });
  });

  it('reads the named desks, and the unpushed commits only where refs is named', () => {
    expect(deskReadsOf([{ key: 'desks', desk: '/d1' }, { key: 'walk' }])).toEqual({ status: new Set(['/d1']), unpushed: false });
    expect(deskReadsOf([{ key: 'refs' }])).toEqual({ status: new Set(), unpushed: true });
  });

  it('reads every desk for a desks reading that names none', () => {
    expect(deskReadsOf([{ key: 'desks' }])).toEqual({ status: 'all', unpushed: false });
  });
});
