import { describe, expect, it } from 'vitest';

import { STORY_STATUS_SLUG, storyOfContent, withStoryStatus } from '../src/rules/story-status-edit.js';

const story = (front: string[]): string => ['---', ...front, '---', '', '# Title', '', 'status: not front matter', ''].join('\n');

describe('storyOfContent', () => {
  it('reads the status, dates and archive date from the front matter', () => {
    const read = storyOfContent(
      story(['title: "A story"', 'author: jw', 'status: done', 'created: 2026-11-01', 'updated: 2026-11-02', 'archived: 2026-11-03']),
      's',
      'docs/stories/s/STORY-s.md',
    );
    expect(read).toEqual({
      slug: 's',
      title: 'A story',
      status: 'done',
      path: 'docs/stories/s/STORY-s.md',
      created: '2026-11-01',
      updated: '2026-11-02',
      author: 'jw',
      archived: '2026-11-03',
    });
  });

  it('reads no archive date as null', () => {
    expect(storyOfContent(story(['status: active']), 's', 'p')?.archived).toBeNull();
  });

  it('answers null for a status outside the six', () => {
    expect(storyOfContent(story(['status: archived']), 's', 'p')).toBeNull();
  });

  it('answers null for a file with no front matter', () => {
    expect(storyOfContent('# Title\n\nstatus: active\n', 's', 'p')).toBeNull();
  });
});

describe('withStoryStatus', () => {
  it('replaces the status line and nothing else', () => {
    const before = story(['title: t', 'status: ready', 'updated: 2026-11-02']);
    const edit = withStoryStatus(before, 'active', null);
    expect(edit.changed).toBe(true);
    expect(edit.content).toBe(before.replace('status: ready', 'status: active'));
    expect(edit.content).toContain('status: not front matter');
  });

  it('inserts the archive date after the status on a move to done', () => {
    const edit = withStoryStatus(story(['status: in-review', 'updated: 2026-11-02']), 'done', '2026-11-16');
    expect(edit.content.split('\n').slice(1, 4)).toEqual(['status: done', 'archived: 2026-11-16', 'updated: 2026-11-02']);
  });

  it('replaces an existing archive date in place', () => {
    const edit = withStoryStatus(story(['status: active', 'archived: 2020-01-01']), 'done', '2026-11-16');
    expect(edit.content.split('\n').slice(1, 3)).toEqual(['status: done', 'archived: 2026-11-16']);
  });

  it('changes nothing where the front matter has no status line', () => {
    const before = story(['title: t']);
    expect(withStoryStatus(before, 'active', null)).toEqual({ changed: false, content: before });
  });

  it('changes nothing in a file with no front matter', () => {
    const before = '# Title\nstatus: ready\n';
    expect(withStoryStatus(before, 'active', null)).toEqual({ changed: false, content: before });
  });
});

describe('STORY_STATUS_SLUG', () => {
  it.each(['a-story', 'ABC-12-name'])('admits %s', (slug) => expect(STORY_STATUS_SLUG.test(slug)).toBe(true));
  it.each(['', '../x', 'a/b', '-x'])('refuses %j', (slug) => expect(STORY_STATUS_SLUG.test(slug)).toBe(false));
});
