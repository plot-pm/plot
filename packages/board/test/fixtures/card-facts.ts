import type { CardFacts } from '@plot-pm/domain/entities/card-facts';
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
