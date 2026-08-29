import { describe, it, expect } from 'vitest';
import {
  StoryStatusSchema, trackerKeyOf, storyIsDone, archivalIsConsistent, type Story,
} from '../src/index.js';

/**
 * An umbrella of knowledge spanning several plans.
 *
 * Its status is STATED — a frontmatter value a human writes — and deliberately
 * has no derived form: the statuses describe what the humans are doing about
 * the knowledge, and no mechanism can observe that. A story whose plans have
 * all delivered may still be `active`.
 */

const story: Story = {
  slug: 'the-master-agent-holds-the-fleet', title: 'The master agent holds the fleet',
  status: 'active', path: 'the-master-agent-holds-the-fleet/STORY-the-master-agent-holds-the-fleet.md',
  created: '2026-08-28', updated: '2026-08-28', author: 'jwloka', archived: null,
};

describe('a story has six statuses, two of them in use here', () => {
  it('names all six', () => {
    // Measured: of nine stories, 6 `active` and 3 `draft`. A vocabulary may be
    // wider than its current use.
    expect(StoryStatusSchema.options).toEqual(['draft', 'ready', 'active', 'in-review', 'paused', 'done']);
    expect(StoryStatusSchema.safeParse('shipped').success).toBe(false);
  });
});

describe('a slug may carry a tracker key', () => {
  it('reads the key when the slug carries one', () => {
    // The only link from a story to an issue that exists today.
    expect(trackerKeyOf('FOOBAR-1234-wcag-audit')).toBe('FOOBAR-1234');
  });

  it('reports none rather than guessing when the slug carries no key', () => {
    expect(trackerKeyOf('the-master-agent-holds-the-fleet')).toBe('');
  });

  it('does not mistake a leading word for a key', () => {
    expect(trackerKeyOf('master-agent-holds-the-fleet')).toBe('');
  });
});

describe('archiving is two writes that must agree', () => {
  it('accepts a live story with no archive date', () => {
    expect(archivalIsConsistent(story)).toBe(true);
    expect(storyIsDone(story)).toBe(false);
  });

  it('accepts a done story carrying its archive date', () => {
    const archived: Story = { ...story, status: 'done', archived: '2026-08-29' };
    expect(storyIsDone(archived)).toBe(true);
    expect(archivalIsConsistent(archived)).toBe(true);
  });

  it('reports a done story with no archive date as half-archived', () => {
    expect(archivalIsConsistent({ ...story, status: 'done' })).toBe(false);
  });

  it('reports an archive date on a story that is not done', () => {
    expect(archivalIsConsistent({ ...story, archived: '2026-08-29' })).toBe(false);
  });
});
