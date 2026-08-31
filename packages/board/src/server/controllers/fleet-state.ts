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
  /**
   * Every plan the estate holds, grouped into the board's phase columns.
   *
   * `built` is the board the caller ALREADY read, passed so the real source can
   * take its columns instead of reading the estate a second time — one
   * `cat-file --batch` and one parser spawn per request, which
   * `plan-read-shape.test.mjs` enforces. A mock ignores both arguments and
   * answers from fixtures.
   */
  columns(opts: BuildBoardOptions, built: FleetStateAnswer): Column[];
  /**
   * The estate's row-shaped view, one row per branch.
   *
   * Awaited, because the real source reads plan statuses through the `Refs`
   * port. A fixture source returns a value and satisfies this by being awaited
   * on a resolved promise — the substitution is unaffected.
   */
  fleet(opts: BuildBoardOptions): Promise<Fleet>;
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
  // Takes the ALREADY-BUILT board rather than building a second one. The
  // parameter is what keeps the real source honest about the single read while
  // leaving a mock free to ignore it — see `boardState`.
  columns: (_opts, built) => built.columns,
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
export const boardState = async ({
  opts,
  estate = realEstateSource,
}: FleetStateQuery): Promise<FleetStateAnswer> => {
  // ONE READ, THEN THE SUBSTITUTION. This spread the result of `buildBoard`
  // and then called `estate.columns(opts)` — which, for the real source, IS
  // `buildBoard(opts)`. Two full board builds per request, each doing its own
  // `cat-file --batch` and its own `plot-plan-meta.sh` spawn.
  //
  // `plan-read-shape.test.mjs` measures exactly that and caught it: two batch
  // reads where its contract allows one. Its own comment prices the regression
  // at ~8 s on this repo's estate, and the guard exists so a board build does
  // not cost more processes because a repo has more plans.
  //
  // The read happens ONCE here and the columns are taken from it; a mock source
  // overrides them without ever reading the real estate, so `mockCards` still
  // REPLACES the payload rather than merging into it.
  const built = await buildBoard(opts);
  return { ...built, columns: estate.columns(opts, built) };
};

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
export const fleetState = ({ opts, estate = realEstateSource }: FleetStateQuery): Promise<Fleet> =>
  estate.fleet(opts);
