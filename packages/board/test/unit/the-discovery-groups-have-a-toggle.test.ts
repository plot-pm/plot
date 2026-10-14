import { describe, expect, it } from 'vitest';
import { archivedOn, boardPath, withArchived } from '../../src/app/lib/archived-toggle.js';
import { showOf, withShow } from '../../src/app/lib/show-toggle.js';

describe('the Discovery group control reads and writes ?show=', () => {
  it('reads tickets and stories, and everything else as both', () => {
    expect(showOf('?show=tickets')).toBe('tickets');
    expect(showOf('?tab=discovery&show=stories')).toBe('stories');
    for (const search of ['', '?show=', '?show=all', '?show=Tickets', '?archived=1']) expect(showOf(search)).toBe('both');
  });

  it('writes show and keeps every other parameter', () => {
    const url = withShow('http://x.invalid/?tab=discovery&archived=1', 'tickets');
    expect(url.search).toBe('?tab=discovery&archived=1&show=tickets');
  });

  it('removes show for both and keeps archived', () => {
    const url = withShow('http://x.invalid/?show=stories&archived=1', 'both');
    expect(url.search).toBe('?archived=1');
  });

  it('survives the Show archived toggle in both directions', () => {
    const off = withArchived('http://x.invalid/?show=stories&archived=1', false);
    expect(off.search).toBe('?show=stories');
    expect(showOf(off.search)).toBe('stories');
    const on = withArchived(off.href, true);
    expect(showOf(on.search)).toBe('stories');
    expect(archivedOn(on.search)).toBe(true);
  });

  it('keeps archived through a change of show, in both orders', () => {
    const a = withShow(withArchived('http://x.invalid/', true).href, 'stories');
    const b = withArchived(withShow('http://x.invalid/', 'stories').href, true);
    for (const url of [a, b]) {
      expect(showOf(url.search)).toBe('stories');
      expect(archivedOn(url.search)).toBe(true);
    }
  });

  it('keeps show off the board request', () => {
    expect(boardPath('?show=tickets')).toBe('/api/board');
    expect(boardPath('?show=stories&archived=1')).toBe('/api/board?archived=1');
  });
});
