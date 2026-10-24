import { describe, expect, it } from 'vitest';

import { offlineIssueRows, type OfflineIssueReading } from '../src/rules/issue-offline-fallback.js';
import type { IssueIndex, IssueIndexRow } from '../src/entities/issue-index.js';

const row = (over: Partial<IssueIndexRow> = {}): IssueIndexRow => ({
  number: '1',
  title: 'a title',
  url: 'https://example.test/1',
  ...over,
});

const index = (over: Partial<IssueIndex> = {}): IssueIndex => ({
  v: 1,
  source: 'tracker',
  connector: 'jira',
  requests: 1,
  nextAt: 0,
  backoffUntil: null,
  answer: 'answered',
  rows: [row()],
  at: '2026-10-23T00:00:00Z',
  ...over,
});

const reading = (over: Partial<OfflineIssueReading> = {}): OfflineIssueReading => ({
  memoryRows: null,
  index: null,
  ownSource: 'tracker',
  ...over,
});

describe('offlineIssueRows', () => {
  it('shows the index rows and age where the board holds no rows and the index matches', () => {
    expect(offlineIssueRows(reading({ index: index() }))).toEqual({
      from: 'index',
      rows: [row()],
      at: '2026-10-23T00:00:00Z',
    });
  });

  it('keeps the in-memory rows over an older file', () => {
    const memoryRows = [row({ number: '2', title: 'held in memory' })];
    expect(offlineIssueRows(reading({ memoryRows, index: index() }))).toEqual({
      from: 'memory',
      rows: memoryRows,
    });
  });

  it('shows nothing where no index file exists', () => {
    expect(offlineIssueRows(reading({ index: null }))).toEqual({ from: 'none' });
  });

  it('shows nothing where the index holds no rows yet', () => {
    expect(offlineIssueRows(reading({ index: index({ rows: undefined, answer: 'unsupported' }) }))).toEqual({
      from: 'none',
    });
  });

  it('shows nothing where the index source does not match this repository’s own source', () => {
    expect(offlineIssueRows(reading({ index: index({ source: 'git-host' }), ownSource: 'tracker' }))).toEqual({
      from: 'none',
    });
  });

  it('keeps an empty-but-present memory array over the index (an answered empty inbox)', () => {
    expect(offlineIssueRows(reading({ memoryRows: [], index: index() }))).toEqual({ from: 'memory', rows: [] });
  });

  it('falls back to a null age where the index carries rows but no `at`', () => {
    expect(offlineIssueRows(reading({ index: index({ at: undefined }) }))).toEqual({
      from: 'index',
      rows: [row()],
      at: null,
    });
  });
});
