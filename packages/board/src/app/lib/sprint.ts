import type { Card, SprintMember } from '../../contract/schema.js';

/**
 * The member list of a sprint the client synthesizes from the cards that name
 * it, for a sprint with no sprint file.
 *
 * A member is checked when its plan's measured `status` is `released`. The
 * card's `phase` is a declared column name, so it cannot answer that question
 * under a map that names its phases differently or puts `plan:released` in a
 * shared column.
 *
 * @param cards - the cards whose `Sprint:` field names the sprint.
 * @returns one `could` member per card, labelled with the card's title.
 */
export const synthesizedSprintMembers = (
  cards: readonly Pick<Card, 'slug' | 'title' | 'status'>[],
): SprintMember[] =>
  cards.map((c) => ({
    slug: c.slug,
    text: c.title,
    tier: 'could' as const,
    checked: c.status === 'released',
    known: true,
  }));
