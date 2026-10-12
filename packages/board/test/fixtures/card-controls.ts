import { cardControls, planStatus, type CardControls } from '@plot-pm/domain';
import type { z } from 'zod';
import type { CardSchema } from '../../src/contract/schema.js';

type CardInput = z.input<typeof CardSchema>;

/** What a fixture states about a card: its card fields, and optionally the plan state behind it. */
export type ControlsInput = Partial<CardInput> & {
  /** The plan file's state word, lowercased. Read before `phase`. */
  state?: string;
};

/**
 * The plan state a fixture card in a named column stands for, where the
 * fixture states no `state`. The names are the default columns plus
 * `Discovery`, which older fixtures still use for a Draft card. A column holds
 * more than one state under some maps, so a fixture that needs a particular
 * one passes `state`.
 *
 * This module sits outside `test/catalogue/`, so a unit test that imports it is
 * not counted as a browser test by `drivesAPage`.
 */
const STATE_BY_COLUMN: Readonly<Record<string, string>> = {
  Discovery: 'draft',
  Design: 'design',
  Development: 'approved',
  Testing: 'delivered',
  Released: 'released',
};

/**
 * The controls the server computes for a fixture card, through `cardControls`,
 * the rule the server calls, so a fixture never restates the rule.
 *
 * The plan state is the fixture's `state`, else the state its `phase` names in
 * {@link STATE_BY_COLUMN}, else `approved`. An absent `phase` reads as
 * `Development`, and any other column name reads as `approved`. The status is
 * the card's own `status`, else the one `planStatus` answers for that state on
 * an unstarted plan with no public review. An absent `started` reads as
 * started, because a fixture that states no `started` stood for a card without
 * the Ready badge.
 */
export const controlsFor = (over: ControlsInput): CardControls => {
  const state = over.state ?? STATE_BY_COLUMN[over.phase ?? 'Development'] ?? 'approved';
  const status = over.status ?? planStatus({
    phase: state, review: 'none', started: false, landed: 'unknown', anyClaimed: false,
  });
  return cardControls({ state, status, started: over.started !== false });
};
