import type { CardFacts } from '@plot-pm/domain/entities/card-facts';
import { CardSchema } from '../../src/contract/schema.js';
import { planFactsOf } from '../../src/server/plan-facts.js';
import { controlsFor } from './card-controls.js';

/**
 * A plan card's facts for a fixture that parses `CardSchema` and reads nothing
 * of the facts: a plain approved plan, through the projection the server calls.
 * A fixture whose assertion reads the facts builds its own with `planFactsOf`.
 */
export const SOME_FACTS: CardFacts = planFactsOf({
  slug: 'a-plan', title: 'A plan', type: 'feature', phase: 'Development',
  path: 'docs/plans/2026-08-24-a-plan.md', prs: [], issues: [], phaseDate: '',
  controls: controlsFor({}),
});

/**
 * A hand-built plan card with the facts the server would attach, through the
 * same projection. For a fixture that states a card as a literal.
 */
export const withFacts = <T extends object>(card: T): T & { facts: CardFacts } => ({
  ...card,
  facts: planFactsOf(CardSchema.omit({ facts: true }).parse(card)),
});
