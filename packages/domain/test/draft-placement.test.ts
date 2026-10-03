import { describe, it, expect } from 'vitest';
import { draftPlacement, type DraftPlacementReadings } from '../src/rules/draft-placement.js';

/**
 * A Draft plan's fresh `open` branch — the base case every test below names
 * the one reading it changes from.
 */
const draft = (over: Partial<DraftPlacementReadings> = {}): DraftPlacementReadings => ({
  planPhase: 'draft',
  state: 'open',
  deferredReason: '',
  fresh: false,
  local: false,
  ...over,
});

describe('draftPlacement — no-work states', () => {
  for (const state of ['blocked', 'waiting', 'unknown', 'open']) {
    it(`answers waiting-on-you/draft for a Draft plan's ${state} branch`, () => {
      expect(draftPlacement(draft({ state }))).toEqual({ group: 'waiting-on-you', note: 'draft' });
    });
  }

  it("answers waiting-on-you/draft for a word that is not a BranchState", () => {
    expect(draftPlacement(draft({ state: 'some-future-state' }))).toEqual({
      group: 'waiting-on-you',
      note: 'draft',
    });
  });
});

describe('draftPlacement — deferred', () => {
  it('answers waiting-on-you/draft for a deferred branch with no written reason', () => {
    expect(draftPlacement(draft({ state: 'deferred' }))).toEqual({
      group: 'waiting-on-you',
      note: 'draft',
    });
  });

  it('answers quiet with the written reason for a deferred branch that has one', () => {
    expect(draftPlacement(draft({ state: 'deferred', deferredReason: 'superseded by #42' }))).toEqual({
      group: 'quiet',
      note: 'superseded by #42',
    });
  });
});

describe('draftPlacement — claimed and wip', () => {
  for (const state of ['claimed', 'wip']) {
    it(`answers waiting-on-you/draft for a fresh ${state} branch`, () => {
      expect(draftPlacement(draft({ state, fresh: true }))).toEqual({
        group: 'waiting-on-you',
        note: 'draft',
      });
    });

    it(`answers waiting-on-you/draft for a ${state} branch with local activity`, () => {
      expect(draftPlacement(draft({ state, local: true }))).toEqual({
        group: 'waiting-on-you',
        note: 'draft',
      });
    });

    it(`answers null for a stale ${state} branch with no local activity`, () => {
      expect(draftPlacement(draft({ state, fresh: false, local: false }))).toBeNull();
    });
  }
});

describe('draftPlacement — merged and non-draft phases', () => {
  it("answers null for a Draft plan's merged branch", () => {
    expect(draftPlacement(draft({ state: 'merged' }))).toBeNull();
  });

  it("answers null for an Approved plan's blocked branch", () => {
    expect(draftPlacement(draft({ planPhase: 'approved', state: 'blocked' }))).toBeNull();
  });

  it("answers null when planPhase is '' (a pre-#140 scan)", () => {
    expect(draftPlacement(draft({ planPhase: '', state: 'blocked' }))).toBeNull();
  });
});
