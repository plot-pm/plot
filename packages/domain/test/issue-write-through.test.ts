import { describe, expect, it } from 'vitest';

import { ISSUE_INDEX_VERSION, type IssueIndex, type IssueIndexRow } from '../src/entities/issue-index.js';
import type { IssueWrite } from '../src/entities/issue-write.js';
import { issueWriteThrough } from '../src/rules/issue-write-through.js';

const row = (n: string, over: Partial<IssueIndexRow> = {}): IssueIndexRow => ({
  number: n,
  title: `issue ${n}`,
  url: `https://example.test/${n}`,
  ...over,
});

const held = (over: Partial<IssueIndex> = {}): IssueIndex => ({
  v: ISSUE_INDEX_VERSION,
  source: 'tracker',
  connector: 'jira',
  account: 'jira:abc',
  requests: 3,
  nextAt: 1_800_000_120_000,
  backoffUntil: 1_800_000_090_000,
  at: '2026-10-13T10:00:00.000Z',
  answer: 'answered',
  rows: [row('A-1', { status: 'To Do', statusCategory: 'To Do', updatedAt: '2026-10-13T09:00:00Z' }), row('A-2')],
  complete: true,
  fullReadAt: '2026-10-13T08:00:00.000Z',
  passesSinceFull: 4,
  closed: { since: '2026-09-29T00:00:00.000Z', at: '2026-10-13T10:00:00.000Z', answer: 'answered', rows: [row('A-9', { statusCategory: 'Done' })], complete: true },
  ...over,
});

const write = (over: Partial<IssueWrite> = {}): IssueWrite => ({
  connector: 'jira',
  account: 'jira:abc',
  number: 'A-1',
  status: 'Delivered',
  ...over,
});

describe('issueWriteThrough', () => {
  it('leaves the cadence fields as held', () => {
    const before = held();
    const after = issueWriteThrough(before, [write()])!;
    for (const key of ['at', 'nextAt', 'backoffUntil', 'answer', 'fullReadAt', 'passesSinceFull', 'complete'] as const) {
      expect(JSON.stringify(after[key])).toBe(JSON.stringify(before[key]));
    }
  });

  it('moves a row written to a closed state from rows to closed.rows', () => {
    const after = issueWriteThrough(held(), [write({ statusCategory: 'Done' })])!;
    expect(after.rows!.map((r) => r.number)).toEqual(['A-2']);
    expect(after.closed!.rows!.map((r) => r.number)).toEqual(['A-9', 'A-1']);
    expect(after.closed!.rows![1]).toMatchObject({ status: 'Delivered', statusCategory: 'Done' });
  });

  it('moves a reopened row from closed.rows back to rows', () => {
    const after = issueWriteThrough(held(), [write({ number: 'A-9', status: 'In Progress', statusCategory: 'In Progress' })])!;
    expect(after.rows!.map((r) => r.number)).toContain('A-9');
    expect(after.closed!.rows).toEqual([]);
  });

  it('does not replace a held row with a write that carries an older updatedAt', () => {
    const after = issueWriteThrough(held(), [write({ updatedAt: '2026-10-13T08:00:00Z' })])!;
    expect(after.rows![0]).toEqual(held().rows![0]);
  });

  it('replaces the held row when the write carries a newer updatedAt', () => {
    const after = issueWriteThrough(held(), [write({ updatedAt: '2026-10-13T11:00:00Z' })])!;
    expect(after.rows![0]).toMatchObject({ status: 'Delivered', updatedAt: '2026-10-13T11:00:00Z' });
  });

  it('keeps the held updatedAt for a write that states none, and drops the category the old status gave', () => {
    const after = issueWriteThrough(held(), [write()])!;
    expect(after.rows![0]).toEqual(row('A-1', { status: 'Delivered', updatedAt: '2026-10-13T09:00:00Z' }));
  });

  it('adds a new row for an opened issue', () => {
    const after = issueWriteThrough(held(), [write({ number: 'A-3', title: 'new', url: 'u', status: undefined })])!;
    expect(after.rows!.at(-1)).toEqual({ number: 'A-3', title: 'new', url: 'u' });
  });

  it('creates no index where none is held', () => {
    expect(issueWriteThrough(null, [write()])).toBeNull();
  });

  it('adds exactly 1 to requests per write on the held connector and account', () => {
    expect(issueWriteThrough(held(), [write()])!.requests).toBe(4);
    expect(issueWriteThrough(held(), [write(), write({ number: 'A-2' })])!.requests).toBe(5);
  });

  it('changes nothing for a write on another connector or account', () => {
    expect(issueWriteThrough(held(), [write({ connector: 'github' })])).toBeNull();
    expect(issueWriteThrough(held(), [write({ account: 'jira:other' })])).toBeNull();
  });

  it('counts the request but invents no row for an issue the index does not hold and the write does not describe', () => {
    const after = issueWriteThrough(held(), [write({ number: 'Z-9' })])!;
    expect(after.requests).toBe(4);
    expect(after.rows!.map((r) => r.number)).toEqual(['A-1', 'A-2']);
  });

  it('removes a closed row from rows only where no closed set was read', () => {
    const after = issueWriteThrough(held({ closed: undefined }), [write({ statusCategory: 'Done' })])!;
    expect(after.rows!.map((r) => r.number)).toEqual(['A-2']);
    expect(after.closed).toBeUndefined();
  });
});
