import { isAnswered } from '@plot-pm/domain';
import { buildBoard, buildBoardFrom, refsFor, type BuildBoardOptions } from '../board.js';
import { boardInputsToServe, buildFleet } from '../fleet.js';
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
 * Identity tags for injected ports, so two different fixture objects for the
 * same `repoRoot` never collapse into the same key.
 *
 * A fixture `Refs`/`Trees`/etc. can't be used as a `Map` key directly (two
 * structurally-identical fixtures built by two different tests are two
 * different objects, and a key must tell them apart), so each object seen is
 * assigned a stable tag on first sight and the tag — not the object — joins
 * the string key below.
 */
const portTags = new WeakMap<object, number>();
let nextPortTag = 0;

const tagFor = (port: object | undefined): string => {
  if (!port) return '-';
  let tag = portTags.get(port);
  if (tag === undefined) {
    tag = nextPortTag++;
    portTags.set(port, tag);
  }
  return String(tag);
};

/**
 * The key that says whether two callers' `opts` describe the SAME estate.
 *
 * `repoRoot` alone is not enough: a caller can also inject `refs`, `trees` and
 * the other {@link BuildBoardOptions} ports, and two callers with the same
 * `repoRoot` but different injected ports must never share a build — one
 * would read a fixture and the other would read real git, so joining them
 * would hand one caller the other's answer. Every port that participates in
 * `buildBoard`'s read joins the key; a port left out would make this slice's
 * own fix invisible to a test built with that port injected.
 */
const keyFor = (opts: BuildBoardOptions): string =>
  [
    opts.repoRoot,
    opts.scriptsDir,
    tagFor(opts.refs),
    tagFor(opts.trees),
    tagFor(opts.planStore),
    tagFor(opts.hostAdapter),
    tagFor(opts.buildAdapter),
    tagFor(opts.spendRecord),
    tagFor(opts.defaultBranchStore),
  ].join(' ');

/**
 * An opaque token over every ref's SHA, read the way `signals.ts:refsSignal`
 * reads it for the `BranchMonitor` — but through the ASYNC `Refs.refState`,
 * never the sync twin. `boardState` runs on the read route's own stack
 * (`a-read-route-spawns-nothing.test.ts` gates exactly that), so the
 * synchronous spawn `refStateSync` makes would land on this request's thread;
 * the async port yields instead.
 *
 * Empty means "could not be read" and never matches another empty token —
 * the same rule `signals.ts:unchanged` applies, so an unreadable ref state
 * never falsely joins a stale build.
 */
const refsToken = async (opts: BuildBoardOptions): Promise<string> => {
  const read = await refsFor(opts).refState('both');
  if (!isAnswered(read)) return '';
  return read.value.map(({ ref, sha }) => `${ref} ${sha}`).join('\n');
};

/** One estate's in-flight build, and the refs token read when it started. */
interface InFlightBuild {
  promise: Promise<Board>;
  startedAt: string;
}

/**
 * The builds `boardState` is already running, keyed by the estate each is
 * building — one build per estate at a time. A second caller for the SAME
 * estate awaits the FIRST caller's promise rather than starting its own; a
 * caller for a DIFFERENT estate (a different repo, or different injected
 * ports) gets its own slot and never waits on another estate's build.
 *
 * Module-level and not per-call: the whole point is for two concurrent HTTP
 * requests (two browser tabs, a poll overtaking a slow previous one) to share
 * one `buildBoard`, which is a module-wide fact about how many are running
 * right now, not a per-request one.
 */
const inFlight = new Map<string, InFlightBuild>();

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
 * **Concurrent callers share one `buildBoard`.** Measured on a loaded
 * development machine (2026-10-19, issue #2083): two `/api/board` requests
 * fired at once each took its OWN batched `plot-plan-meta.sh` spawn, and the
 * two spawns competed for the same CPU — both answered in ~5 s where a single
 * request alone answered in ~3-4.5 s. `buildBoard` holds no server-side state
 * a second concurrent run could read stale, so sharing one in-flight build
 * costs nothing a second independent build would have given a poller, and
 * removes exactly that self-inflicted multiplier. Each caller still applies
 * its OWN `estate.columns` afterwards, so a mock source is unaffected and two
 * callers with different estates never share a build — only `realEstateSource`
 * calls ever overlap on `inFlight`.
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
  //
  // A MOCK ESTATE NEVER JOINS `inFlight` — only the real source's build is
  // worth sharing, and a test or a fixture caller building its own `opts` must
  // get its own answer every time.
  let built: Board;
  if (estate === realEstateSource) {
    const key = keyFor(opts);
    // ON `snapshot`, THE BUILD IS KEYED BY THE SNAPSHOT AND READS FROM IT: no
    // ref listing for the key, and none inside the build. Any reading the
    // cards need that is not read sends the request down the board's own path.
    const served = await boardInputsToServe(opts);
    const now = served === null ? await refsToken(opts) : served.key;
    const current = inFlight.get(key);
    // A joiner arriving after something changed does not await the stale
    // build — refs moved since it started, so its answer is already wrong for
    // this caller. Start (and key) a fresh one instead.
    if (current && (!now || current.startedAt !== now)) {
      inFlight.delete(key);
    }
    const existing = inFlight.get(key);
    if (existing) {
      built = await existing.promise;
    } else {
      const promise = (served === null ? buildBoard(opts) : buildBoardFrom(opts, served.inputs)).finally(() => {
        if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
      });
      inFlight.set(key, { promise, startedAt: now });
      built = await promise;
    }
  } else {
    built = await buildBoard(opts);
  }
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
