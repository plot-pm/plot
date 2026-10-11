import { describe, expect, it } from 'vitest';

import { AgentStateSchema } from '../src/entities/agent.js';
import { PR_INDEX_VERSION, type PrIndex, type PrIndexRow } from '../src/entities/pr-index.js';
import { deskBranchMerged, mergedDeskState } from '../src/rules/merged-desk.js';

const BRANCH = 'bug/the-channel-stamps-what-it-hears';

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 1513,
  head: BRANCH,
  state: 'MERGED',
  draft: false,
  checks: 'green',
  review: '',
  url: '',
  ...over,
});

const store = (rows: readonly PrIndexRow[]): PrIndex => ({
  v: PR_INDEX_VERSION,
  connector: 'github',
  watermark: null,
  complete: true,
  at: '2026-10-11T00:00:00Z',
  rows: [...rows],
});

describe('mergedDeskState', () => {
  it('reads a dead waiting desk whose PR merged as finished', () => {
    expect(mergedDeskState({ state: 'waiting', workerAlive: false, merged: true })).toBe('finished');
  });

  it('keeps waiting while the worker pid is alive', () => {
    expect(mergedDeskState({ state: 'waiting', workerAlive: true, merged: true })).toBe('waiting');
  });

  it('keeps waiting when no merged PR is known', () => {
    expect(mergedDeskState({ state: 'waiting', workerAlive: false, merged: false })).toBe('waiting');
  });

  it('changes no state other than waiting', () => {
    for (const state of AgentStateSchema.options.filter((s) => s !== 'waiting')) {
      expect(mergedDeskState({ state, workerAlive: false, merged: true })).toBe(state);
    }
  });
});

describe('deskBranchMerged', () => {
  it('answers true for a merged row whose head is the branch', () => {
    expect(deskBranchMerged(store([row()]), BRANCH)).toBe(true);
  });

  it('answers false for an open, closed or draft row', () => {
    expect(deskBranchMerged(store([row({ state: 'OPEN' })]), BRANCH)).toBe(false);
    expect(deskBranchMerged(store([row({ state: 'CLOSED' })]), BRANCH)).toBe(false);
    expect(deskBranchMerged(store([row({ draft: true })]), BRANCH)).toBe(false);
  });

  it('answers false for no store, no row and an empty branch', () => {
    expect(deskBranchMerged(null, BRANCH)).toBe(false);
    expect(deskBranchMerged(store([row({ head: 'feature/other' })]), BRANCH)).toBe(false);
    expect(deskBranchMerged(store([row({ head: '' })]), '')).toBe(false);
  });
});
