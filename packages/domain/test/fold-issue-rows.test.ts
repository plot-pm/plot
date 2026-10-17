import { describe, expect, it } from 'vitest';

import { foldChangedIssueRows, foldIssueRows } from '../src/rules/fold-issue-rows.js';
import type { IssueIndexRow } from '../src/entities/issue-index.js';

const row = (over: Partial<IssueIndexRow> = {}): IssueIndexRow => ({
  number: '1',
  title: 'a title',
  url: 'https://example.test/1',
  ...over,
});

describe('foldIssueRows', () => {
  it('keeps the incoming row when its updatedAt is newer', () => {
    const held = [row({ title: 'old', updatedAt: '2026-10-01T00:00:00Z' })];
    const incoming = [row({ title: 'new', updatedAt: '2026-10-02T00:00:00Z' })];
    expect(foldIssueRows(held, incoming)).toEqual([row({ title: 'new', updatedAt: '2026-10-02T00:00:00Z' })]);
  });

  it('keeps the held row when the incoming updatedAt is older', () => {
    const held = [row({ title: 'kept', updatedAt: '2026-10-02T00:00:00Z' })];
    const incoming = [row({ title: 'stale', updatedAt: '2026-10-01T00:00:00Z' })];
    expect(foldIssueRows(held, incoming)).toEqual([row({ title: 'kept', updatedAt: '2026-10-02T00:00:00Z' })]);
  });

  it('replaces with the incoming row on an equal updatedAt', () => {
    const held = [row({ title: 'held', updatedAt: '2026-10-02T00:00:00Z' })];
    const incoming = [row({ title: 'incoming', updatedAt: '2026-10-02T00:00:00Z' })];
    expect(foldIssueRows(held, incoming)).toEqual([row({ title: 'incoming', updatedAt: '2026-10-02T00:00:00Z' })]);
  });

  it('replaces with the incoming row where neither side has an updatedAt', () => {
    const held = [row({ title: 'held' })];
    const incoming = [row({ title: 'incoming' })];
    expect(foldIssueRows(held, incoming)).toEqual([row({ title: 'incoming' })]);
  });

  it('loses to a held row with an updatedAt when the incoming row has none', () => {
    const held = [row({ title: 'held', updatedAt: '2026-10-02T00:00:00Z' })];
    const incoming = [row({ title: 'incoming' })];
    expect(foldIssueRows(held, incoming)).toEqual([row({ title: 'held', updatedAt: '2026-10-02T00:00:00Z' })]);
  });

  it('wins over a held row with no updatedAt when the incoming row has one', () => {
    const held = [row({ title: 'held' })];
    const incoming = [row({ title: 'incoming', updatedAt: '2026-10-02T00:00:00Z' })];
    expect(foldIssueRows(held, incoming)).toEqual([row({ title: 'incoming', updatedAt: '2026-10-02T00:00:00Z' })]);
  });

  it('keeps a key present on only one side', () => {
    const held = [row({ number: '1', title: 'held-only' })];
    const incoming = [row({ number: '2', title: 'incoming-only' })];
    expect(foldIssueRows(held, incoming)).toEqual([
      row({ number: '1', title: 'held-only' }),
      row({ number: '2', title: 'incoming-only' }),
    ]);
  });

  it('does not mutate either input array', () => {
    const held = [row({ number: '1', title: 'held' })];
    const incoming = [row({ number: '1', title: 'incoming', updatedAt: '2026-10-02T00:00:00Z' })];
    const heldCopy = [...held];
    const incomingCopy = [...incoming];
    foldIssueRows(held, incoming);
    expect(held).toEqual(heldCopy);
    expect(incoming).toEqual(incomingCopy);
  });

  it('is order-independent for rows with distinct updatedAt', () => {
    const a = row({ number: '1', title: 'a', updatedAt: '2026-10-01T00:00:00Z' });
    const b = row({ number: '1', title: 'b', updatedAt: '2026-10-02T00:00:00Z' });
    expect(foldIssueRows([a], [b])).toEqual([b]);
    expect(foldIssueRows([b], [a])).toEqual([b]);
  });
});

describe('foldChangedIssueRows', () => {
  const SINCE = '2026-10-01T00:00:00.000Z';

  it('moves a row closed inside the window from the open set to the closed set', () => {
    const done = row({ statusCategory: 'Done', closedAt: '2026-10-05T00:00:00.000+0000' });
    expect(foldChangedIssueRows([row()], [], SINCE, [done])).toEqual({ rows: [], closedRows: [done] });
  });

  it('drops a row closed before the window from both sets', () => {
    const done = row({ statusCategory: 'Done', closedAt: '2026-09-05T00:00:00Z' });
    expect(foldChangedIssueRows([row()], [], SINCE, [done])).toEqual({ rows: [], closedRows: [] });
  });

  it('drops a Done row with no closedAt from both sets', () => {
    expect(foldChangedIssueRows([row()], [], SINCE, [row({ statusCategory: 'Done' })])).toEqual({ rows: [], closedRows: [] });
  });

  it('moves a reopened row from the closed set to the open set', () => {
    const reopened = row({ statusCategory: 'To Do' });
    const held = row({ statusCategory: 'Done', closedAt: '2026-10-05T00:00:00Z' });
    expect(foldChangedIssueRows([], [held], SINCE, [reopened])).toEqual({ rows: [reopened], closedRows: [] });
  });
});
