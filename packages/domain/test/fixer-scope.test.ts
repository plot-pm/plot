import { describe, expect, it } from 'vitest';

import type { PrIndexRow } from '../src/entities/pr-index.js';
import type { Sprint } from '../src/entities/sprint.js';
import {
  claimStaleMsOf,
  fixerOwner,
  fixerScope,
  PERSON_QUIET_MS,
  type ClaimCommit,
  type FixerOwnerInput,
  type FixerScopeInput,
} from '../src/rules/fixer-scope.js';
import { fixerPrNext, slicePrNext, type FixerPrNextReadings } from '../src/rules/slice-pr-next.js';

const HEAD = 'a'.repeat(40);
const NOW = Date.parse('2026-11-20T12:00:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 7,
  head: 'feature/x',
  base: 'main',
  state: 'OPEN',
  draft: false,
  checks: 'failing',
  review: '',
  url: 'u',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'failing',
  plotReview: 'absent',
  headSince: iso(NOW - 2 * HOUR),
  ...over,
});

const scope = (over: Partial<FixerScopeInput> = {}): ReturnType<typeof fixerScope> =>
  fixerScope({ row: row(), defaultBranchName: 'main', owner: 'none', pushedHead: false, now: NOW, ...over });

const claim = (at: number): ClaimCommit => ({ at, subject: 'plot: claim feature/x', tree: 't', parentTree: 't' });
const work = (at: number): ClaimCommit => ({ at, subject: 'fix: a thing', tree: 't2', parentTree: 't' });

const owner = (over: Partial<FixerOwnerInput> = {}): ReturnType<typeof fixerOwner> =>
  fixerOwner({ worktree: 'absent', manifest: false, claims: [], claimStaleMs: 24 * HOUR, now: NOW, ...over });

describe('fixerScope', () => {
  it.each([
    ['no-row', { row: null }],
    ['not-open', { row: row({ state: 'MERGED' }) }],
    ['draft', { row: row({ draft: true }) }],
    ['release-pr', { row: row({ head: 'changeset-release/main' }) }],
    ['plan-pr', { row: row({ head: 'idea/a-plan' }) }],
    ['repair-owned', { row: row({ head: 'bug/main-repair-0123456789ab' }) }],
    ['repair-owned', { row: row({ head: 'bug/sprint-repair-0123456789ab', base: 'sprint/s' }) }],
    ['repair-owned', { row: row({ head: 'bug/revert-42' }) }],
    ['base-unread', { row: row({ base: undefined }) }],
    ['base-unread', { row: row({ base: '' }) }],
    ['base-unread', { defaultBranchName: undefined }],
    ['base-unread', { defaultBranchName: '' }],
    ['base-out-of-scope', { row: row({ base: 'release/1' }) }],
    ['owner-unread', { owner: 'unread' }],
    ['head-age-unread', { row: row({ headSince: undefined }) }],
    ['head-age-unread', { row: row({ headSince: 'yesterday-ish' }) }],
  ] as const)('answers %s', (why, over) => {
    expect(scope(over as Partial<FixerScopeInput>)).toMatchObject({ in: false, why });
  });

  it('keeps a repair-like branch whose hex is not 12 characters in scope', () => {
    expect(scope({ row: row({ head: 'bug/main-repair-abc' }) })).toEqual({ in: true, owner: 'none' });
  });

  it('takes a PR into a sprint branch and refuses a PR into a release branch', () => {
    expect(scope({ row: row({ base: 'sprint/s' }) })).toEqual({ in: true, owner: 'none' });
    expect(scope({ row: row({ base: 'release/1' }) })).toEqual({ in: false, why: 'base-out-of-scope' });
  });

  it('holds a deskless head under an hour old and carries the time left', () => {
    expect(scope({ row: row({ headSince: iso(NOW - 59 * MIN) }) })).toEqual({
      in: false,
      why: 'person-pushed-recently',
      leftMs: 1 * MIN,
    });
    expect(scope({ row: row({ headSince: iso(NOW - 60 * MIN) }) })).toEqual({ in: true, owner: 'none' });
    expect(scope({ row: row({ headSince: iso(NOW - 61 * MIN) }) })).toEqual({ in: true, owner: 'none' });
    expect(PERSON_QUIET_MS).toBe(HOUR);
  });

  it('skips the hour for a head the fixer pushed and for a branch an agent owns', () => {
    const fresh = row({ headSince: iso(NOW - 5 * MIN) });
    expect(scope({ row: fresh, pushedHead: true })).toEqual({ in: true, owner: 'none' });
    expect(scope({ row: fresh, owner: 'desk' })).toEqual({ in: true, owner: 'desk' });
  });

  it('checks the owner before the head age', () => {
    expect(scope({ row: row({ headSince: undefined }), owner: 'unread' })).toEqual({ in: false, why: 'owner-unread' });
  });
});

describe('fixerOwner', () => {
  it('answers desk for a manifest naming the branch', () => {
    expect(owner({ manifest: true })).toBe('desk');
  });

  it('answers desk for a claim marker held by a worktree here', () => {
    expect(owner({ worktree: 'here', claims: [claim(NOW - 48 * HOUR)] })).toBe('desk');
  });

  it('answers none for a hand-made worktree with no manifest and no claim', () => {
    expect(owner({ worktree: 'here', claims: [work(NOW - HOUR)] })).toBe('none');
  });

  it('answers none for a stale claim elsewhere and desk for a fresh one', () => {
    expect(owner({ claims: [claim(NOW - 24 * HOUR), work(NOW - HOUR)] })).toBe('none');
    expect(owner({ claims: [claim(NOW - 23 * HOUR)] })).toBe('desk');
  });

  it('never stales a claim where the bound did not parse', () => {
    expect(owner({ claims: [claim(NOW - 1000 * HOUR)], claimStaleMs: null })).toBe('desk');
  });

  it('answers unread where any reading failed', () => {
    expect(owner({ worktree: 'unread', manifest: true })).toBe('unread');
    expect(owner({ manifest: 'unread' })).toBe('unread');
    expect(owner({ claims: 'unread', manifest: true })).toBe('unread');
  });
});

describe('claimStaleMsOf', () => {
  it('reads hours and refuses what is not a positive number', () => {
    expect(claimStaleMsOf('24')).toBe(24 * HOUR);
    expect(claimStaleMsOf(' 1.5 ')).toBe(1.5 * HOUR);
    expect(claimStaleMsOf('')).toBeNull();
    expect(claimStaleMsOf('0')).toBeNull();
    expect(claimStaleMsOf('soon')).toBeNull();
  });
});

describe('fixerPrNext', () => {
  const fresh = { read: 'record', inFlight: false, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false } as const;
  const readings = (over: Partial<FixerPrNextReadings> = {}): FixerPrNextReadings => ({
    row: row(),
    newestMerged: null,
    reviewRun: null,
    reviewStarts: null,
    verdict: { read: 'absent' },
    defaultBranch: null,
    defaultBranchName: 'main',
    desk: { dead: false, why: 'elsewhere' },
    backend: 'github',
    mergerApp: { read: 'usable' },
    config: { autoReview: false, reviewBoundMs: HOUR, startBudget: 3, checksWaitMs: HOUR },
    fixer: fresh,
    correctionsSpentExhausted: false,
    owner: 'none',
    now: NOW,
    ...over,
  });

  it('starts the fixer on a deskless red PR that slicePrNext leaves out of scope', () => {
    expect(fixerPrNext(readings())).toEqual({ step: 'fixer', head: HEAD, evidence: 'ci-red' });
    const sprintScope = { read: 'scope', sprint: {} as Sprint, slugs: ['y'], branches: ['feature/y'] } as const;
    expect(slicePrNext({ ...readings(), scope: sprintScope })).toMatchObject({ step: 'none', why: 'out-of-scope' });
  });

  it('carries the time left of a held head', () => {
    expect(fixerPrNext(readings({ row: row({ headSince: iso(NOW - 50 * MIN) }) }))).toEqual({
      step: 'none',
      why: 'person-pushed-recently',
      leftMs: 10 * MIN,
    });
  });

  it('answers the scope reason for a row out of scope', () => {
    expect(fixerPrNext(readings({ row: row({ base: undefined }) }))).toEqual({ step: 'none', why: 'base-unread' });
    expect(fixerPrNext(readings({ owner: 'unread' }))).toEqual({ step: 'none', why: 'owner-unread' });
  });

  it('hands a desk-owned PR the desk reading it has', () => {
    const live = readings({ owner: 'desk', desk: { dead: false, why: 'live' } });
    expect(fixerPrNext(live)).toMatchObject({ step: 'none' });
    expect(fixerPrNext(readings({ owner: 'desk', desk: { dead: true } }))).toEqual({ step: 'fixer', head: HEAD, evidence: 'ci-red' });
  });
});
