import { ticketCardFacts, withActionAvailability } from '@plot-pm/domain';
import type { Ref, UnknownReach } from '@plot-pm/domain/entities/card-facts';
import type { TicketLaneGroups } from '../../src/contract/schema.js';

type Lane = 'open' | 'in-progress' | 'done';

/**
 * Ticket lanes as `/api/board` serves them: each row carries the facts
 * `ticketCardFacts` reads from it, with no plan naming it.
 *
 * @param lanes - the lane groups, rows without facts.
 * @param over - the stories answering each ticket, by id, absent reading as none; `storiesUnknown` reads the ticket → story index as unbuilt.
 * @returns the same lanes with `facts` on every row.
 */
export const withTicketFacts = (
  lanes: TicketLaneGroups,
  over: { stories?: Record<string, Ref[]>; storiesUnknown?: UnknownReach; available?: Record<string, boolean> } = {},
) => {
  const factsFor = (lane: Lane) => (row: TicketLaneGroups[Lane][number]) => ({
    ...row,
    facts: withActionAvailability(
      ticketCardFacts({ row, lane, plans: { value: [] }, stories: over.storiesUnknown ? { unknown: over.storiesUnknown } : { value: over.stories?.[row.id] ?? [] } }),
      over.available ?? { 'create-plan': true, 'create-story': true },
    ),
  });
  return {
    open: lanes.open.map(factsFor('open')),
    'in-progress': lanes['in-progress'].map(factsFor('in-progress')),
    done: lanes.done.map(factsFor('done')),
    moreCount: lanes.moreCount,
  };
};
