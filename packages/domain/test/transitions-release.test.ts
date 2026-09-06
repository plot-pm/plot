import { describe, expect, it } from 'vitest';
import { ReleaseStateSchema, type Release, type ReleaseState } from '../src/entities/release.js';
import {
  isDecision,
  isRefusal,
  observeReleaseState,
  releaseStateObservable,
  RELEASE_LIFECYCLE,
} from '../src/transitions/release.js';

/** A tagged release — `date` and `commit` are what a cut tag supplies. */
const releaseWith = (over: Partial<Release> = {}): Release => ({
  version: 'v2.13.0',
  state: 'planned',
  date: '2026-09-06',
  commit: 'abc1234',
  channel: 'release',
  checklist: null,
  ...over,
});

const move = (from: ReleaseState, to: string, over: Partial<Release> = {}) =>
  observeReleaseState(releaseWith({ state: from, ...over }), { to });

describe('the states are consumed, never redeclared', () => {
  it('names the states the entity owns, in the order it draws them', () => {
    expect([...RELEASE_LIFECYCLE]).toEqual([...ReleaseStateSchema.options]);
  });
});

describe('a version is planned, perhaps a candidate, then shipped', () => {
  it('ships a planned version directly, which is what every patch does', () => {
    expect(isDecision(move('planned', 'shipped'))).toBe(true);
  });

  it('goes through candidate where an RC checklist exists', () => {
    const rc = { channel: 'rc' as const, checklist: 'docs/releases/2.13.0-rc.md' };
    expect(isDecision(move('planned', 'candidate', rc))).toBe(true);
  });

  it('reports a shipped version as immutable, and nothing else', () => {
    const shipped = move('planned', 'shipped');
    expect(isDecision(shipped) && shipped.immutable).toBe(true);
    const candidate = move('planned', 'candidate', {
      channel: 'rc', checklist: 'docs/releases/2.13.0-rc.md',
    });
    expect(isDecision(candidate) && candidate.immutable).toBe(false);
  });

  it('canonicalises the version it answers about', () => {
    const result = observeReleaseState(releaseWith({ version: '2.13.0' }), { to: 'shipped' });
    expect(isDecision(result) && result.version).toBe('v2.13.0');
  });

  it('answers the same question through the callable-alone form', () => {
    expect(releaseStateObservable(releaseWith(), 'shipped')).toBe(true);
    expect(releaseStateObservable(releaseWith({ state: 'shipped' }), 'planned')).toBe(false);
  });
});

describe('it refuses what the lifecycle does not admit', () => {
  it('refuses a release naming no version', () => {
    const result = observeReleaseState(releaseWith({ version: '  ' }), { to: 'shipped' });
    expect(isRefusal(result) && result.reason).toBe('version-unreadable');
  });

  it('refuses an unrecognised state', () => {
    const result = move('planned', 'draft');
    expect(isRefusal(result) && result.reason).toBe('state-unrecognised');
  });

  it('refuses a move to the state it already holds', () => {
    const result = move('planned', 'planned');
    expect(isRefusal(result) && result.reason).toBe('state-unchanged');
  });

  it('refuses to move a shipped tag — it is immutable', () => {
    // A version people already fetched cannot be made to mean something else,
    // so a change gets a new version.
    const result = move('shipped', 'candidate');
    expect(isRefusal(result) && result.reason).toBe('state-terminal');
  });

  it('refuses a candidate returning to planned — the rc tag exists', () => {
    const result = move('candidate', 'planned');
    expect(isRefusal(result) && result.reason).toBe('state-unreachable');
  });

  it('refuses any state past planned with no tag to derive it from', () => {
    for (const missing of [{ date: null }, { commit: null }]) {
      const result = move('planned', 'shipped', missing);
      expect(isRefusal(result) && result.reason).toBe('tag-missing');
    }
  });

  it('refuses a candidate with no checklist — that is what the stage is for', () => {
    const result = move('planned', 'candidate', { channel: 'rc', checklist: null });
    expect(isRefusal(result) && result.reason).toBe('checklist-missing');
  });
});

describe('the channel is a classification, not a stage', () => {
  it('refuses to ship an rc tag — a release tag is cut alongside it', () => {
    const result = move('candidate', 'shipped', {
      channel: 'rc', checklist: 'docs/releases/2.13.0-rc.md',
    });
    expect(isRefusal(result) && result.reason).toBe('channel-mismatch');
  });

  it('refuses to make a release tag a candidate', () => {
    const result = move('planned', 'candidate', {
      channel: 'release', checklist: 'docs/releases/2.13.0-rc.md',
    });
    expect(isRefusal(result) && result.reason).toBe('channel-mismatch');
  });

  it('refuses on an unmet precondition, quoting what the source said', () => {
    const result = observeReleaseState(releaseWith(), {
      to: 'shipped',
      preconditions: [{ name: 'tags-listed', met: false, detail: 'git exited 128' }],
    });
    expect(isRefusal(result) && result.reason).toBe('precondition-unmet');
    expect(isRefusal(result) && result.detail).toContain('git exited 128');
  });

  it('names an unmet reading that said nothing', () => {
    const result = observeReleaseState(releaseWith(), {
      to: 'shipped',
      preconditions: [{ name: 'tags-listed', met: false }],
    });
    expect(isRefusal(result) && result.detail).toBe("the reading 'tags-listed' is not met");
  });
});
