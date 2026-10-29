/**
 * What a sprint member needs to say it opens a plan.
 */
export interface SprintItemDestinationInput {
  /** The plan slug the sprint line names, or empty for a bare item. */
  slug: string;
  /** Whether the board has a card for this slug. */
  known: boolean;
}

/**
 * Which card a sprint member's row should open, if any.
 *
 * `known: false` means the board marked this member's slug as naming no plan
 * it can find — on the ref, the working tree, or any branch (`board.ts`'s
 * card-building already covers all three). A set of card slugs that happens
 * to lack the member's slug is the same fact read a second way, so both gates
 * apply: there is no destination for an unknown member, an empty slug, or a
 * slug with no card.
 *
 * @param member - the slug and known-ness the board recorded for this item.
 * @param cardSlugs - every card slug the board currently has.
 * @returns the slug to open, or null where the member has no destination.
 */
export const sprintItemDestination = (
  member: SprintItemDestinationInput,
  cardSlugs: ReadonlySet<string>,
): string | null => {
  if (!member.known) return null;
  if (member.slug === '') return null;
  if (!cardSlugs.has(member.slug)) return null;
  return member.slug;
};
