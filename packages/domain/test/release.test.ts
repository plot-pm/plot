import { describe, it, expect } from 'vitest';
import {
  ReleaseStateSchema, ReleaseChannelSchema, normalizeVersion, sameVersion,
  channelFor, hasShipped, type Release,
} from '../src/index.js';

/**
 * A version of the software, identified by its tag.
 *
 * The estate writes that tag two ways: measured across every `Released:` line,
 * 70 carry the `v` and 40 do not, while all 129 git tags carry it. A consumer
 * matching the recorded string against `git tag` resolves 70 and misses 40 —
 * the Person finding in a different field, free text where a normalized value
 * belongs.
 */

const release: Release = {
  version: 'v2.5.0', state: 'shipped', date: '2026-08-19', commit: 'abc123',
  channel: 'release', checklist: null,
};

describe('the release vocabularies are closed sets', () => {
  it('names the three states — a release has a life before its tag', () => {
    expect(ReleaseStateSchema.options).toEqual(['planned', 'candidate', 'shipped']);
  });

  it('names the two channels', () => {
    expect(ReleaseChannelSchema.options).toEqual(['release', 'rc']);
  });
});

describe('a version normalizes to one spelling', () => {
  it('resolves both measured spellings to the tag', () => {
    expect(normalizeVersion('2.9.0')).toBe('v2.9.0');
    expect(normalizeVersion('v2.5.0')).toBe('v2.5.0');
  });

  it('ignores surrounding space', () => {
    expect(normalizeVersion('  2.5.1  ')).toBe('v2.5.1');
  });

  it('leaves an unrecorded version empty rather than inventing a tag', () => {
    // 3 released plans carry no `Released:` record at all, which the scan reads
    // as having no version. `v` alone is not a version.
    expect(normalizeVersion('')).toBe('');
    expect(normalizeVersion('   ')).toBe('');
  });

  it('matches the two spellings against each other', () => {
    expect(sameVersion('2.5.0', 'v2.5.0')).toBe(true);
    expect(sameVersion('2.5.0', 'v2.5.1')).toBe(false);
  });
});

describe('a candidate is not a release', () => {
  it('reads a suffixed tag as a candidate', () => {
    expect(channelFor('v2.1.0-rc.1')).toBe('rc');
  });

  it('reads a plain tag as a release', () => {
    expect(channelFor('v2.1.0')).toBe('release');
    expect(channelFor('2.1.0')).toBe('release');
  });
});

describe('shipping is a state, not a date', () => {
  it('reports a shipped release', () => {
    expect(hasShipped(release)).toBe(true);
  });

  it('does not report a planned one, which has no tag yet', () => {
    const planned: Release = { ...release, state: 'planned', date: null, commit: null };
    expect(hasShipped(planned)).toBe(false);
    expect(planned.date).toBeNull();
  });
});
