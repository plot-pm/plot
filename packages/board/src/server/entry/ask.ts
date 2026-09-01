import { boardState, fleetState, type EstateSource } from '../controllers/fleet-state.js';
import { deliverabilityOf, type DeliverabilityAnswer } from '../controllers/deliverability.js';
import type { BuildBoardOptions } from '../board.js';
import { realEstate, type Estate } from '../estate.js';
import type { Board, Fleet } from '../../contract/schema.js';
import {
  estateFingerprint,
  sameEstate,
  type EstateFingerprint,
} from './estate-fingerprint.js';

/**
 * The master agent's entry point: one call, no HTTP, the controller's own
 * answer.
 *
 * **`node`, not a live board.** The alternative was asking a running board over
 * HTTP, which is faster when one exists — the answer is already in memory from
 * the last pulse — and answers nothing when one does not. Measured while the
 * plan was being decided: no board was running. Seven skills would have gained
 * a dependency on a service that has always been optional, and the failure
 * would arrive as a skill that works on the operator's machine and not in a
 * worker's.
 *
 * **The cost is stated and accepted:** this path re-derives what a running
 * board already computed. It makes nothing slower than today — a skill pays
 * what it pays now — but forgoes a saving that was available. An HTTP fast path
 * can be added later *without changing any caller*, because this module is the
 * seam: it can consult a board first and fall back. Adding it now would mean
 * two paths to one answer before either is proven.
 */

/**
 * What the master agent can ask for.
 *
 * `deliverable` differs from the other two in what it reads. `board` and
 * `fleet` answer from the scan's pulse, which a one-shot process does not have
 * — `ensureCache` starts the refresh and returns before it lands, so a `node`
 * run reports `ready: false`. That is honest for a status board and useless for
 * a gate: `plot-deliver.sh` must answer now, and a cold pulse would refuse
 * every delivery.
 *
 * So this question reads the branches through `plot-plan-meta.sh` and their
 * merge state through `plot-impl-status.sh` — the two scripts the shell already
 * ran — and asks the domain about those. Same rule, no pulse, no wait.
 */
export type Question = 'board' | 'fleet' | 'deliverable';

/** What a caller must say to ask. */
export interface Ask {
  question: Question;
  opts: BuildBoardOptions;
  /** Where to read from. Defaults to the real repository, as the route's does. */
  estate?: EstateSource;
  /**
   * The ports, for the questions a controller answers by asking them.
   *
   * `deliverable` only. It travels beside `estate` rather than replacing it
   * because the other two questions still read the synchronous source, and
   * reshaping a type three questions share to serve one would move work this
   * slice did not promise.
   */
  ports?: Estate;
  /** The configured plan directory, for the estate measurement. */
  planDir?: string;
  /** The plan asked about — `deliverable` only. */
  slug?: string;
  /** That plan's file, resolved by the caller — `deliverable` only. */
  planFile?: string;
}

/**
 * An answer, with the measurement that produced it.
 *
 * The fingerprint travels WITH the answer rather than beside it because it is
 * what makes the answer re-usable: a caller holding both can ask whether a
 * later estate still matches, which is the whole of {@link askOncePerEstate}.
 */
export interface Answer<T> {
  value: T;
  estate: EstateFingerprint;
  /** True when this answer was computed, false when a prior one was re-used. */
  measured: boolean;
}

/**
 * Ask the controller, measuring the estate as it does.
 *
 * **The transport placeholders are left exactly as the controller emits them.**
 * `buildBoard` zeroes all eleven — ten availability flags and `server` —
 * because the `Board` schema requires the fields, and the HTTP route overwrites
 * them at response time where the binding is known. The previous slice recorded
 * that a caller with no server therefore reads `available: false` on every
 * flag, "honest about the binding but reads like a refusal rather than an
 * absence", and left the shape to this entry point.
 *
 * **This entry point does not rewrite them, and that is the answer rather than
 * a deferral.** Rewriting would mean inventing a value no caller supplied: the
 * flags answer *may THIS caller act*, and a `node` process holding no request
 * is not a caller any of them were written about. Blanking them to `true` would
 * assert a permission nobody granted; blanking them to `null` would change the
 * payload the route serialises, which is the one thing this plan's slices have
 * each refused to do.
 *
 * So the honest reading is the one the field names already support: an
 * unavailable capability with an EMPTY reason is an absence, and every refusal
 * a real caller produces carries a sentence. {@link askedWithoutTransport} is
 * that distinction made checkable, so a skill reading this answer can tell the
 * two apart without guessing.
 *
 * @param ask what to ask and where to read it from
 * @returns the controller's answer and the estate it was read from
 */
export const askOnce = async (
  ask: Ask,
): Promise<Answer<Board | Fleet | DeliverabilityAnswer>> => {
  // MEASURED BEFORE, NOT AFTER. A fingerprint taken after the read would
  // describe an estate the answer may not have come from: the scan runs for
  // minutes, and anything landing inside that window would be stamped onto an
  // answer computed before it. Taken first, the digest is a lower bound — the
  // answer is at least as new as the estate it names, which is the direction
  // that fails safe.
  const estate = estateFingerprint(ask.opts, ask.planDir);
  // A controller that asks ports needs them, and no default can invent one: a
  // caller with no ports gets the refusal rather than a guess at its estate.
  const ports = ask.ports ?? realEstate({ repoRoot: ask.opts.repoRoot, scriptsDir: ask.opts.scriptsDir });
  const value =
    ask.question === 'deliverable'
      ? await deliverabilityOf(
          { planStore: ports.planStore, host: ports.host },
          ask.slug ?? '',
          ask.planFile ?? '',
        )
      : ask.question === 'fleet'
        ? fleetState({ opts: ask.opts, estate: ask.estate })
        : boardState({ opts: ask.opts, estate: ask.estate });
  return { value, estate, measured: true };
};

/**
 * Whether an answer came from a caller that holds no transport.
 *
 * The check a skill needs to read {@link askOnce}'s answer correctly: it
 * separates "this capability refused" from "nobody asked on behalf of a
 * caller". A refusal names its reason; an absence cannot.
 *
 * @param board an answer from the entry point or the route
 * @returns true when every capability is unavailable for no stated reason
 */
export const askedWithoutTransport = (board: Board): boolean =>
  board.server.port === 0 &&
  (['dispatch', 'approve', 'continue', 'idea', 'commission',
    'reslice', 'deliver', 'implement', 'drop', 'story'] as const)
    .every((flag) => !board[flag].available && board[flag].reason === '');

/**
 * A caller's memory of one answer, so an unchanged estate is measured once.
 *
 * **Per-caller, not global, and that bound is load-bearing.** The fingerprint
 * cannot see the git host's open-PR set — measuring it would cost the network
 * call the cache exists to avoid — so a cache that outlived its caller could
 * hold an answer that a remote merge had already invalidated. Scoped to one
 * run, the only changes that can happen between two asks are the ones the
 * caller itself made, and those are local edits and pushes the digest sees.
 */
export interface EstateMemory {
  last?: {
    estate: EstateFingerprint;
    value: Board | Fleet | DeliverabilityAnswer;
    question: Question;
  };
}

/** A fresh memory, holding nothing. */
export const newMemory = (): EstateMemory => ({});

/**
 * Ask, re-using the previous answer when the estate has not moved.
 *
 * **This is the delivery-landed gate's saving, stated as a function.** That
 * gate runs the scan, applies a fix when its grep finds drift, then re-runs and
 * repeats until the grep is empty. The re-run reads an estate the first run
 * already measured — and when the fix changed nothing the scan reads, the two
 * runs are the same question asked twice.
 *
 * **A changed estate produces a second measurement, always.** That is the
 * property the brief demanded and the reason the key is a digest of content
 * rather than a timer: the gate's own fix is a plan edit and a push, and both
 * move the digest. A cache that could hide one would turn a delivery guard into
 * a claim that the guard had run.
 *
 * @param memory the caller's memory, carried across asks in one run
 * @param ask what to ask
 * @returns the answer, `measured: false` when the previous one was re-used
 */
export const askOncePerEstate = async (
  memory: EstateMemory,
  ask: Ask,
): Promise<Answer<Board | Fleet | DeliverabilityAnswer>> => {
  const estate = estateFingerprint(ask.opts, ask.planDir);
  const held = memory.last;
  if (held && held.question === ask.question && sameEstate(held.estate, estate)) {
    return { value: held.value, estate, measured: false };
  }
  const fresh = await askOnce(ask);
  memory.last = { estate: fresh.estate, value: fresh.value, question: ask.question };
  return fresh;
};
