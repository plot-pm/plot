import { describe, it, expect } from 'vitest';
import type { Card } from '../../src/contract/schema';
import { plansInStory } from '../../src/app/components/StoryModal';

/** A card with only the fields the story overlay's plan list reads. */
function card(slug: string, phase: Card['phase'], story?: string): Card {
  return {
    slug,
    title: `Plan: ${slug}`,
    type: 'feature',
    phase,
    path: `docs/plans/2026-01-01-${slug}.md`,
    prs: [],
    ...(story ? { story } : {}),
  };
}

describe('plansInStory', () => {
  it('selects the story\'s plans and no others', () => {
    const cards = [
      card('netting', 'Design', 'berry-patch'),
      card('apples', 'Released', 'orchard'),
      card('mulch', 'Testing', 'berry-patch'),
      card('loose', 'Design'),
    ];
    expect(plansInStory(cards, 'berry-patch').map((c) => c.slug)).toEqual(['netting', 'mulch']);
  });

  it('orders by board phase, so the list reads as a pipeline', () => {
    const cards = [
      card('shipped', 'Released', 's'),
      card('idea', 'Discovery', 's'),
      card('building', 'Development', 's'),
    ];
    expect(plansInStory(cards, 's').map((c) => c.phase)).toEqual([
      'Discovery', 'Development', 'Released',
    ]);
  });

  it('is DERIVED — a stale hand-written section cannot influence it', () => {
    // The whole reason the overlay does not parse the STORY file's
    // "Current Plan" prose. Here the prose (below) names a plan that does not
    // exist and omits both that do; the derived list must show the two real
    // ones and never the invented one.
    const storyProse = `
      ## Current Plan
      - Dig the second bed
    `;
    const cards = [
      card('netting', 'Design', 'berry-patch'),
      card('compost', 'Testing', 'berry-patch'),
    ];
    const derived = plansInStory(cards, 'berry-patch').map((c) => c.slug);
    expect(derived).toEqual(['netting', 'compost']);
    expect(storyProse).toContain('Dig the second bed');
    expect(derived).not.toContain('second-bed');
  });

  it('answers empty for a story with no plans, rather than throwing', () => {
    // "Shaped, nothing planned yet" is a real state — the same one the swimlane
    // row states as "no plans yet".
    expect(plansInStory([card('loose', 'Design')], 'berry-patch')).toEqual([]);
  });

  it('does not mutate the caller\'s array while sorting', () => {
    const cards = [card('b', 'Released', 's'), card('a', 'Discovery', 's')];
    const before = cards.map((c) => c.slug);
    plansInStory(cards, 's');
    expect(cards.map((c) => c.slug)).toEqual(before);
  });
});
