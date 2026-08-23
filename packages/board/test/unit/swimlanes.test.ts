import { describe, it, expect } from 'vitest';
import { buildLanes, LANE_PHASES } from '../../src/app/components/Swimlanes.js';
import { BOARD_PHASES, type Board, type Card, type Phase, type StoryCard }
  from '../../src/contract/schema.js';

const card = (slug: string, story?: string, phase: Phase = 'Design'): Card => ({
  slug, title: slug, type: 'feature', phase,
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

  it('shows the same plans as the column view, over ONE payload', () => {
    // The invariant the two views must share. A Draft plan visible in columns
    // and absent from lanes is the original bug inverted — and it was exactly
    // what the old `BOARD_PHASES.filter(p => p !== 'Discovery')` produced the
    // moment a plan could reach Discovery.
    //
    // Both sides are derived from one board object rather than from two lists
    // that could agree by being written together.
    const cards: Card[] = [
      card('under-review', 'plot-board', 'Discovery'),
      card('waiting', 'plot-board', 'Design'),
      card('in-flight', 'plot-board', 'Development'),
      card('merged', 'plot-board', 'Testing'),
      card('shipped', 'plot-board', 'Released'),
    ];
    const board: Board = {
      generatedAt: '', columns: BOARD_PHASES.map((phase) => ({
        phase, cards: cards.filter((c) => c.phase === phase),
      })),
      dispatch: { available: false, reason: '' }, checklist: null,
      sprints: [], stories: [{ slug: 'plot-board', title: 'Board', status: 'active' }],
    };

    const inColumns = board.columns.flatMap((c) => c.cards.map((x) => x.slug)).sort();
    // What a lane actually renders: for each lane, the cards it buckets into
    // each of LANE_PHASES — the same expression the component uses.
    const lanes = buildLanes(board.columns.flatMap((c) => c.cards), board.stories);
    const inLanes = lanes
      .flatMap((lane) => LANE_PHASES.flatMap(
        (phase) => lane.cards.filter((c) => c.phase === phase).map((c) => c.slug),
      ))
      .sort();

    expect(inLanes).toEqual(inColumns);
    // Named explicitly, because it is the one that used to be dropped.
    expect(inLanes).toContain('under-review');
  });

  it('renders every board phase as a lane column, Discovery included', () => {
    // Pinned as a list rather than as "does not filter", so a future filter of
    // any shape fails here.
    expect(LANE_PHASES).toEqual(BOARD_PHASES);
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
