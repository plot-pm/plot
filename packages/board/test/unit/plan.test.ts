import { describe, it, expect } from 'vitest';
import { planHref, storyHref } from '../../src/app/lib/plan';

describe('planHref', () => {
  it('routes to /plan/<basename> from a repo-relative plan path', () => {
    expect(planHref({ path: 'docs/plans/2026-07-12-foo.md' })).toBe('/plan/2026-07-12-foo.md');
  });

  it('uses only the basename regardless of nesting (e.g. active/ symlinks)', () => {
    expect(planHref({ path: 'docs/plans/active/bar.md' })).toBe('/plan/bar.md');
  });

  it('percent-encodes unusual characters in the basename', () => {
    expect(planHref({ path: 'docs/plans/a b&c.md' })).toBe('/plan/a%20b%26c.md');
  });

  it('extracts the basename from a Windows-separator path', () => {
    // card.path uses the OS separator (path.relative); on Windows that is a
    // backslash. Splitting only on '/' would leave the whole path as the
    // "basename" and produce a broken /plan/docs%5Cplans%5C... URL.
    expect(planHref({ path: 'docs\\plans\\2026-07-12-foo.md' })).toBe('/plan/2026-07-12-foo.md');
  });
});

describe('storyHref', () => {
  it('routes to /story/<slug>, keyed on the slug the server allowlists', () => {
    // The PATH is not in the URL: the server matches a slug against the stories
    // it collected, because a slug is both a directory name and part of the
    // filename. Sending the path would ask the client to encode that
    // convention a second time.
    expect(storyHref({ slug: 'plot-board', path: 'docs/stories/plot-board/STORY-plot-board.md' }))
      .toBe('/story/plot-board');
  });

  it('returns "" for a story with no file, so nothing renders a link', () => {
    // The rule plan rows already follow for `planFile: ''`. A plan can name a
    // story nobody has written; the badge stays text rather than becoming a
    // link that 404s.
    expect(storyHref({ slug: 'ghost-story', path: '' })).toBe('');
  });

  it('percent-encodes unusual characters in the slug', () => {
    expect(storyHref({ slug: 'a b&c', path: 'docs/stories/a b&c/STORY-a b&c.md' }))
      .toBe('/story/a%20b%26c');
  });
});
