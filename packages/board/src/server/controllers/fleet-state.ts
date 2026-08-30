import { buildBoard, type BuildBoardOptions } from '../board.js';
import { buildFleet } from '../fleet.js';
import { mockCards, mockFleet, mockRequested } from '../mock-fleet.js';
import type { Board, Fleet } from '../../contract/schema.js';

/**
 * What a caller must supply to ask about fleet state.
 *
 * Deliberately the estate options and nothing else: no `host`, no port, no
 * request. A controller that needed one of those could not be called by the
 * master agent, which has none of them.
 */
export interface FleetStateQuery {
  opts: BuildBoardOptions;
}

/**
 * The estate's answer to "what is on the board?" — every plan, story, sprint
 * and topic, with the plan-source report that says which ref they came from.
 *
 * This is {@link Board} unchanged rather than a new shape. The controller moves
 * where the question is asked, not what the answer contains; a re-shaping here
 * would make the payload assertion this slice rests on impossible to state.
 */
export type FleetStateAnswer = Board;

/**
 * Fleet state: the question `/api/board` and `/api/fleet` both serve.
 *
 * Takes typed arguments and returns a typed result — HTTP is one caller, the
 * master agent is another, a test is a third. Nothing here knows which it is
 * talking to.
 *
 * The mock substitution lives here rather than in the route because it answers
 * *what is the estate*, which is this function's question. It replaces the
 * columns rather than adding to them, for the reason `mockCards` records: half
 * the board's controls are gated on a card, and rows without cards render none
 * of them.
 *
 * @param query where to read the estate from
 * @returns the board answer, mock columns substituted when asked for
 */
export const boardState = ({ opts }: FleetStateQuery): FleetStateAnswer => ({
  ...buildBoard(opts),
  ...(mockRequested() ? { columns: mockCards() } : {}),
});

/**
 * The same estate, in the fleet's row-shaped view: one row per branch, read
 * from the cache the server refreshes on its own timer.
 *
 * Never runs the scan inline — see `buildFleet`. A synchronous scan on a poll
 * would block the single-threaded server for a large fraction of every cycle.
 *
 * @param query where to read the estate from
 * @returns the fleet rows, or the mock fleet when asked for
 */
export const fleetState = ({ opts }: FleetStateQuery): Fleet =>
  mockRequested() ? mockFleet() : buildFleet(opts);
