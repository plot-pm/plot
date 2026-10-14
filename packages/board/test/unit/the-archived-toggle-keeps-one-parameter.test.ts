import { describe, expect, it } from 'vitest';
import { archivedOn, boardPath, withArchived } from '../../src/app/lib/archived-toggle.js';

// Issue #1670 H3: the Discovery toggle lives in `?archived=1` and in no other
// parameter, so the Planning tab's `?released=1` stays a control of its own.

describe('the Show archived toggle reads and writes one parameter', () => {
  it('reads archived=1 as on and nothing else as on', () => {
    expect(archivedOn('?archived=1')).toBe(true);
    expect(archivedOn('?tab=discovery&archived=1')).toBe(true);
    expect(archivedOn('')).toBe(false);
    expect(archivedOn('?archived=0')).toBe(false);
    expect(archivedOn('?archived=true')).toBe(false);
    expect(archivedOn('?released=1')).toBe(false);
  });

  it('writes archived=1 and keeps every other parameter', () => {
    const url = withArchived('http://x.invalid/?tab=discovery&released=1', true);
    expect(url.searchParams.get('archived')).toBe('1');
    expect(url.searchParams.get('released')).toBe('1');
    expect(url.searchParams.get('tab')).toBe('discovery');
  });

  it('removes archived when the toggle turns off and keeps every other parameter', () => {
    const url = withArchived('http://x.invalid/?archived=1&released=1', false);
    expect(url.searchParams.has('archived')).toBe(false);
    expect(url.search).toBe('?released=1');
  });

  it('does not turn on from the Planning toggle', () => {
    expect(archivedOn(withArchived('http://x.invalid/?released=1', false).search)).toBe(false);
  });

  it('puts archived=1 and no other parameter on the board request', () => {
    expect(boardPath('?archived=1&released=1&tab=discovery')).toBe('/api/board?archived=1');
    expect(boardPath('?released=1')).toBe('/api/board');
    expect(boardPath('')).toBe('/api/board');
  });
});
