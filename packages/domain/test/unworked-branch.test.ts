import { describe, expect, it } from 'vitest';

import { noteShown, unworkedPlacement } from '../src/rules/unworked-branch.js';

const WORKING = { group: 'working', startability: 'no-known-worker' } as const;

describe('unworkedPlacement', () => {
  const base = { state: 'claimed', workerLive: false, fresh: true, local: false };

  it('places a fresh claim with no live worker in WORKING', () => {
    expect(unworkedPlacement(base)).toEqual(WORKING);
  });

  it('places a fresh wip branch in WORKING', () => {
    expect(unworkedPlacement({ ...base, state: 'wip' })).toEqual(WORKING);
  });

  it('places a stale claim with local activity in WORKING', () => {
    expect(unworkedPlacement({ ...base, fresh: false, local: true })).toEqual(WORKING);
  });

  it('places a stale wip branch with local activity in WORKING', () => {
    expect(unworkedPlacement({ ...base, state: 'wip', fresh: false, local: true })).toEqual(WORKING);
  });

  it('leaves a stale claim with no local activity to the caller', () => {
    expect(unworkedPlacement({ ...base, fresh: false })).toBeNull();
  });

  it('leaves a stale wip branch with no local activity to the caller', () => {
    expect(unworkedPlacement({ ...base, state: 'wip', fresh: false })).toBeNull();
  });

  it('leaves a branch with a live worker to the caller', () => {
    expect(unworkedPlacement({ ...base, workerLive: true })).toBeNull();
  });

  it.each(['open', 'merged', 'blocked', 'deferred', 'unknown', ''])('leaves a %s branch to the caller', (state) => {
    expect(unworkedPlacement({ ...base, state, local: true })).toBeNull();
  });
});

describe('noteShown', () => {
  it('shows the note of a QUIET row with a quiet kind', () => {
    expect(noteShown({ startability: 'someone-is-on-it', group: 'quiet', quietKind: 'abandoned' })).toBe(true);
  });

  it('hides the note of a QUIET row with no kind and someone on it', () => {
    expect(noteShown({ startability: 'someone-is-on-it', group: 'quiet', quietKind: null })).toBe(false);
  });

  it('hides the note of a non-QUIET row that has a kind and someone on it', () => {
    expect(noteShown({ startability: 'someone-is-on-it', group: 'working', quietKind: 'abandoned' })).toBe(false);
  });

  it('shows the note of a no-known-worker row', () => {
    expect(noteShown({ startability: 'no-known-worker', group: 'working', quietKind: null })).toBe(true);
  });

  it('shows the note of a row with no startability', () => {
    expect(noteShown({ startability: null, group: 'done', quietKind: null })).toBe(true);
  });
});
