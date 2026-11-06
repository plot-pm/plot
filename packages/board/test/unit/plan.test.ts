import { describe, it, expect } from 'vitest';
import { boardLinksOf, linkTargetOf, storyHref } from '../../src/app/lib/plan';
import type { Board, Card, StoryCard } from '../../src/contract/schema.js';
import { checksUrlOf } from '../../src/server/board.js';

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

describe('linkTargetOf: what each item on a card links to', () => {
  /** A board holding one plan and one story, its fields cut to what the lookups read. */
  const boardOf = (over: Partial<Pick<Board, 'columns' | 'stories' | 'branchUrlBase'>>) => boardLinksOf({
    tickets: null, branchUrlBase: '', stories: [], columns: [], ...over,
  });
  const plan = { slug: 'other', path: 'docs/plans/2026-11-01-other.md' } as Card;
  const links = boardOf({
    columns: [{ phase: 'Development', cards: [plan] }] as Board['columns'],
    stories: [{ slug: 'st', path: 'docs/stories/st/STORY-st.md' } as StoryCard],
    branchUrlBase: 'https://github.com/o/r/tree/',
  });
  const prs = [{ number: 7, url: 'https://github.com/o/r/pull/7', checksUrl: 'https://github.com/o/r/pull/7/checks' }];

  it('a sprint, a plan and a story open their board view in place', () => {
    expect(linkTargetOf({ kind: 'sprint', slug: 'sp', title: 'T', state: 'Active', release: '2.31.0' }, 'item', prs, links))
      .toEqual({ href: '/?sprint=sp', external: false, opens: { kind: 'sprint', slug: 'sp' } });
    expect(linkTargetOf({ kind: 'plan', slug: 'other', key: null, title: 'O', status: 'approved' }, 'item', prs, links))
      .toMatchObject({ href: '/plan/2026-11-01-other.md', external: false, opens: { kind: 'plan', card: { slug: 'other' } } });
    expect(linkTargetOf({ kind: 'story', slug: 'st', title: 'S', status: 'active', archived: false }, 'item', prs, links))
      .toMatchObject({ href: '/story/st', external: false, opens: { kind: 'story', story: { slug: 'st' } } });
  });

  it('a PR, its build and a branch open the host; a ticket opens the address its issue row carries', () => {
    const slice = { kind: 'slice', plan: 'x', branch: 'feature/a b', pr: 7 } as const;
    expect(linkTargetOf(slice, 'item', prs, links)).toEqual({ href: 'https://github.com/o/r/pull/7', external: true, opens: null });
    expect(linkTargetOf(slice, 'build', prs, links)).toEqual({ href: 'https://github.com/o/r/pull/7/checks', external: true, opens: null });
    expect(linkTargetOf({ ...slice, pr: null }, 'item', prs, links))
      .toEqual({ href: 'https://github.com/o/r/tree/feature/a%20b', external: true, opens: null });
    // No issue row names the key and the board knows no issue page, so the ticket stays text.
    expect(linkTargetOf({ kind: 'ticket', key: '3101', title: '3101', lane: null }, 'item', prs, links)).toBeNull();
  });

  it('a ticket links its issue row\'s URL, else the repository\'s issue page for a number, never for another key', () => {
    const withIssues = boardLinksOf({
      tickets: { open: [{ id: 7, url: 'https://tracker.example/7' }], 'in-progress': [], done: [] } as unknown as Board['tickets'],
      branchUrlBase: '', stories: [], columns: [], issueUrlBase: 'https://github.com/o/r/issues/',
    });
    const ticket = (key: string) => linkTargetOf({ kind: 'ticket', key, title: key, lane: null }, 'item', [], withIssues);
    expect(ticket('7')).toEqual({ href: 'https://tracker.example/7', external: true, opens: null });
    expect(ticket('3069')).toEqual({ href: 'https://github.com/o/r/issues/3069', external: true, opens: null });
    expect(ticket('PROJ-12')).toBeNull();
  });

  it('a ticket whose address is not http or https stays text, with no fallback to the issue page', () => {
    const unsafe = boardLinksOf({
      tickets: {
        open: [{ id: 7, url: 'javascript:alert(1)' }, { id: 8, url: 'data:text/html,x' }, { id: 9, url: 'http://tracker.example/9' }],
        'in-progress': [], done: [],
      } as unknown as Board['tickets'],
      branchUrlBase: '', stories: [], columns: [], issueUrlBase: 'https://github.com/o/r/issues/',
    });
    const ticket = (key: string) => linkTargetOf({ kind: 'ticket', key, title: key, lane: null }, 'item', [], unsafe);
    expect(unsafe.ticketHref('7')).toBeUndefined();
    expect(ticket('7')).toBeNull();
    expect(ticket('8')).toBeNull();
    expect(ticket('9')).toEqual({ href: 'http://tracker.example/9', external: true, opens: null });
    // An issue page prefix with another scheme gives no link either.
    const badBase = boardLinksOf({ tickets: null, branchUrlBase: '', stories: [], columns: [], issueUrlBase: 'javascript:void//' });
    expect(badBase.ticketHref('12')).toBeUndefined();
  });

  it('an item the board holds no reading for stays text', () => {
    const bare = boardOf({});
    expect(linkTargetOf({ kind: 'plan', slug: 'gone', key: null, title: 'G', status: 'approved' }, 'item', [], bare)).toBeNull();
    expect(linkTargetOf({ kind: 'slice', plan: 'x', branch: 'feature/a', pr: null }, 'item', [], bare)).toBeNull();
    expect(linkTargetOf({ kind: 'slice', plan: 'x', branch: 'feature/a', pr: 7 }, 'build', [], bare)).toBeNull();
  });

  it('a checks page is the GitHub PR URL plus /checks, and nothing on another host', () => {
    expect(checksUrlOf('https://github.com/o/r/pull/7', 'https://github.com/o/r/tree/')).toBe('https://github.com/o/r/pull/7/checks');
    expect(checksUrlOf('https://bitbucket.org/o/r/pull-requests/7', 'https://bitbucket.org/o/r/branch/')).toBe('');
    expect(checksUrlOf('', 'https://github.com/o/r/tree/')).toBe('');
  });
});
