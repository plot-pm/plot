import { buildBoard, type BuildBoardOptions } from '../board.js';
import { buildFleet } from '../fleet.js';
import type { Board, Column, Fleet } from '../../contract/schema.js';

/**
 * Where a controller reads the estate from.
 *
 * The two questions this controller serves, each as a function it CALLS rather
 * than a world it reaches. A caller supplies the pair; a controller cannot tell
 * whether they read git or a fixture, which is the whole substitution.
 *
 * This is the driven side in the shape the synchronous board still needs. The
 * `PlanStore` and `Refs` ports are the same seam one layer down, and the
 * migration that puts them here is
 * `production-calls-the-domain-one-rule-at-a-time` — the plan that repoints
 * every call site at an adapter. Until then this pair is what the composition
 * root substitutes.
 */
export interface EstateSource {
  /** Every plan the estate holds, grouped into the board's phase columns. */
  columns(opts: BuildBoardOptions): Column[];
  /** The estate's row-shaped view, one row per branch. */
  fleet(opts: BuildBoardOptions): Fleet;
}

/**
 * What a caller must supply to ask about fleet state.
 *
 * Deliberately the estate options and nothing else: no `host`, no port, no
 * request. A controller that needed one of those could not be called by the
 * master agent, which has none of them.
 */
export interface FleetStateQuery {
  opts: BuildBoardOptions;
  /** Where to read from. Defaults to the real repository. */
  estate?: EstateSource;
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
 * The repository as it really is — plans read from disk, rows from the scan
 * cache.
 *
 * The default rather than a special case: a caller that supplies nothing gets
 * the real estate, which is what every production call site already wanted.
 */
export const realEstateSource: EstateSource = {
  columns: (opts) => buildBoard(opts).columns,
  fleet: (opts) => buildFleet(opts),
};

/**
 * Fleet state: the question `/api/board` and `/api/fleet` both serve.
 *
 * Takes typed arguments and returns a typed result — HTTP is one caller, the
 * master agent is another, a test is a third. Nothing here knows which it is
 * talking to.
 *
 * **Nothing here knows a mock exists, either.** The substitution happens by
 * which {@link EstateSource} the caller constructed, so this function reads no
 * environment and holds no branch about mocking. That is what lets a mock
 * board serve this controller unmodified.
 *
 * The columns are REPLACED rather than merged into, for the reason `mockCards`
 * records: half the board's controls are gated on a card, and rows without
 * cards render none of them.
 *
 * @param query where to read the estate from
 * @returns the board answer
 */
export const boardState = ({
  opts,
  estate = realEstateSource,
}: FleetStateQuery): FleetStateAnswer => ({
  ...buildBoard(opts),
  columns: estate.columns(opts),
});

/**
 * The same estate, in the fleet's row-shaped view: one row per branch, read
 * from the cache the server refreshes on its own timer.
 *
 * Never runs the scan inline — see `buildFleet`. A synchronous scan on a poll
 * would block the single-threaded server for a large fraction of every cycle.
 *
 * @param query where to read the estate from
 * @returns the fleet rows
 */
export const fleetState = ({ opts, estate = realEstateSource }: FleetStateQuery): Fleet =>
  estate.fleet(opts);
