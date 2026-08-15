import { describe, it, expect } from 'vitest';
import { buildLanes } from '../../src/app/components/Swimlanes.js';
import type { Card, StoryCard } from '../../src/contract/schema.js';

const card = (slug: string, story?: string): Card => ({
  slug, title: slug, type: 'feature', phase: 'Design',
  path: `docs/plans/${slug}.md`, ...(story ? { story } : {}),
});
const story = (slug: string, status = 'active'): StoryCard => ({
  slug, title: `Story ${slug}`, status,
});

describe('buildLanes', () => {
  it('gives each story a row, in the order the stories arrive', () => {
    const lanes = buildLanes([card('a', 'one'), card('b', 'two')], [story('one'), story('two')]);
    expect(lanes.map((l) => l.key)).toEqual(['one', 'two']);
  });

  it('keeps a story with no plans as a row, not as an empty state', () => {
    // "Shaped, nothing planned yet" IS the Discovery phase — hiding the row
    // would hide the one thing the row header exists to show.
    const lanes = buildLanes([], [story('empty')]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].cards).toEqual([]);
  });

  it('collects plans without a story into a catch-all row, placed last', () => {
    const lanes = buildLanes([card('a', 'one'), card('loose')], [story('one')]);
    expect(lanes.at(-1)?.key).toBe('__none__');
    expect(lanes.at(-1)?.cards.map((c) => c.slug)).toEqual(['loose']);
  });

  it('omits the catch-all row when every plan has a story', () => {
    const lanes = buildLanes([card('a', 'one')], [story('one')]);
    expect(lanes.map((l) => l.key)).toEqual(['one']);
  });

  it('never drops a plan naming a story that has no file', () => {
    // A typo or a story not yet written must not make work vanish from the
    // board. It gets its own row, labelled for what it is.
    const lanes = buildLanes([card('a', 'ghost')], [story('one')]);
    const ghost = lanes.find((l) => l.key === 'ghost');
    expect(ghost, 'an unknown story slug still gets a lane').toBeTruthy();
    expect(ghost?.subtitle).toMatch(/no story file/);
    expect(ghost?.cards.map((c) => c.slug)).toEqual(['a']);
  });

  it('accounts for every card exactly once across all lanes', () => {
    // The invariant that matters: lanes partition the board. A card counted
    // twice would double-report work; one dropped would hide it.
    const cards = [card('a', 'one'), card('b', 'one'), card('c', 'ghost'), card('d')];
    const lanes = buildLanes(cards, [story('one'), story('empty')]);
    const seen = lanes.flatMap((l) => l.cards.map((c) => c.slug)).sort();
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
  });

  it('carries the story status into the row subtitle', () => {
    const lanes = buildLanes([], [story('one', 'paused')]);
    expect(lanes[0].subtitle).toBe('one · paused');
  });

  it('falls back to the slug when a story has no title', () => {
    const lanes = buildLanes([], [{ slug: 'bare', title: '', status: '' }]);
    expect(lanes[0].title).toBe('bare');
    expect(lanes[0].subtitle).toBe('bare');
  });
});
