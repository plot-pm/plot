import { cardControls, type CardControls, type PlanStatus } from '@plot-pm/domain';
import type { z } from 'zod';
import type { Card, CardSchema } from '../../src/contract/schema.js';

type CardInput = z.input<typeof CardSchema>;

/**
 * The plan state and status a fixture card in each column stands for: the
 * inverse of `toBoardPhase`, with the status `planStatus` answers for that
 * state. A card's controls come from these readings through `cardControls`, the
 * rule the server calls, so a fixture never restates the rule.
 *
 * This module sits outside `test/catalogue/`, so a unit test that imports it is
 * not counted as a browser test by `drivesAPage`.
 */
const READINGS_BY_PHASE: Record<Card['phase'], { state: string; status: PlanStatus }> = {
  Discovery: { state: 'draft', status: 'draft' },
  Design: { state: 'design', status: 'draft' },
  Development: { state: 'approved', status: 'approved' },
  Testing: { state: 'delivered', status: 'delivered' },
  Released: { state: 'released', status: 'released' },
};

/**
 * The controls the server computes for a fixture card. A card's own `status`
 * replaces the column's. An absent `phase` reads as `Development`. An absent
 * `started` reads as started, because a fixture that states no `started` stood
 * for a card without the Ready badge.
 */
export const controlsFor = (over: Partial<CardInput>): CardControls => {
  const readings = READINGS_BY_PHASE[over.phase ?? 'Development'];
  return cardControls({
    state: readings.state,
    status: over.status ?? readings.status,
    started: over.started !== false,
  });
};
