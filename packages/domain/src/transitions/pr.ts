import { PrStateSchema, prHasLanded, type Pr, type PrState } from '../entities/pr.js';

/*
 * THE HOST OWNS THIS LIFECYCLE AND PLOT ONLY READS IT. A pull request opens,
 * merges or closes on the host's own schedule, and nothing here writes any of
 * it — so a transition is a VERDICT on what the host reported, and the gates
 * are about whether that report can be believed.
 *
 * `state` ALONE IS NOT THE ANSWER, AND THAT IS THE WHOLE FILE.
 * `entities/pr.ts:3` says it: *"What the host says a PR's state is. Not
 * trustworthy alone."* A merged PR reports `CLOSED`, which is why
 * `plot-pr-merged.sh` reads `mergedAt` and why `scripts/check-ancestry-decisions.sh`
 * bans the alternative. This file makes the disagreement refusable rather than
 * remembered: `state: 'CLOSED'` with a `mergedAt` is a MERGED pull request, and
 * a caller reading the word alone is reading the wrong field.
 *
 * `prHasLanded` IS THE ONE READING OF LANDING and is consumed rather than
 * re-derived. Two implementations of *did this land* is the drift that deletes
 * a ref somebody still needed.
 */

/**
 * The states, in the order a pull request passes through them.
 *
 * Re-exported as a value because a renderer groups by state and needs the
 * order; `PrStateSchema.options` carries the same three and is the source.
 * **The states are not redeclared** — `entities/pr.ts:9` owns them.
 */
export const PR_LIFECYCLE: readonly PrState[] = ['OPEN', 'MERGED', 'CLOSED'];

/**
 * Which states each state may become.
 *
 * `OPEN` is the only state anything leaves. Both ends are terminal on the
 * host's word: neither a merge nor a close reopens by itself, and a reopened
 * pull request is one a person reopened, which arrives as a fresh reading
 * rather than as a move this rule saw.
 *
 * `CLOSED -> MERGED` is NOT a move and is deliberately absent. A merged PR
 * reporting `CLOSED` is one reading of one moment, not two states in sequence
 * — {@link observePrState} resolves it by reading `mergedAt` instead of
 * admitting a transition that never happened.
 */
const NEXT: Readonly<Record<PrState, readonly PrState[]>> = {
  OPEN: ['MERGED', 'CLOSED'],
  MERGED: [],
  CLOSED: [],
};

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape the other transition files use, and for the same reason: a
 * pull request lives on a host, and the domain reaches no network.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a pull-request transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-unrecognised'
  | 'state-terminal'
  | 'state-unreachable'
  | 'state-unchanged'
  | 'merged-reported-closed'
  | 'merge-record-missing'
  | 'draft-cannot-merge'
  | 'precondition-unmet';

/**
 * A refused transition, naming which gate fired.
 *
 * @see RefusalReason for the gates.
 */
export interface Refusal {
  readonly outcome: 'refused';
  /** Which gate fired — branched on rather than matched as prose. */
  readonly reason: RefusalReason;
  /** The pull request the refusal is about, as `repo#number`. */
  readonly id: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that holds: the state the host reported, resolved.
 *
 * Carries nothing to write. The host owns the pull request; a caller acts on
 * `landed` rather than recording this answer.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The pull request, as `repo#number`. */
  readonly id: string;
  /** The state it held. */
  readonly from: PrState;
  /** The state it now holds. */
  readonly to: PrState;
  /** Whether its work landed, read from `mergedAt` and never from `to`. */
  readonly landed: boolean;
}

/** What a pull-request transition answers: the state, or the gate that stopped it. */
export type TransitionResult = Decision | Refusal;

/**
 * Narrows a result to a held transition.
 *
 * @param result - the result to test.
 * @returns true when the transition holds.
 */
export const isDecision = (result: TransitionResult): result is Decision =>
  result.outcome === 'decided';

/**
 * Narrows a result to a refusal.
 *
 * @param result - the result to test.
 * @returns true when a gate stopped the transition.
 */
export const isRefusal = (result: TransitionResult): result is Refusal =>
  result.outcome === 'refused';

const refuse = (id: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  id,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param id - the pull request the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (id: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    id,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (state: string): state is PrState =>
  (PrStateSchema.options as readonly string[]).includes(state);

/**
 * A pull request's identity, as `entities/pr.ts:44` settles it.
 *
 * The pair, never the number alone: numbering restarts per repository, so a
 * bare number names a different pull request in each. A PR in this repository
 * carries `repo: ''` and reads as `#42`.
 *
 * @param repo - `owner/repo`, or `''` where the PR is in this repository.
 * @param number - the number, unique within `repo`.
 * @returns the composite identity, `repo#number`.
 */
export const prId = (repo: string, number: number): string => `${repo}#${number}`;

/** What `observePrState` needs beyond the pull request. */
export interface ObservePrInput {
  /** The state the host now reports. */
  to: string;
  /** Readings a caller measured, such as whether the host answered at all. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a pull request may be observed to hold a given state.
 *
 * Callable alone, because a board must know whether a row's move is legal
 * before rendering it. It is not a permission: {@link observePrState}
 * re-checks.
 *
 * @param pr - the pull request to test.
 * @param to - the state it would be observed in.
 * @returns true when the gates would pass.
 */
export const prStateObservable = (pr: Pr, to: string): boolean =>
  !isRefusal(observePrState(pr, { to }));

/**
 * Judges a change of pull-request state that the host has already reported.
 *
 * **A `CLOSED` reading over a `mergedAt` is refused, not believed.** That pair
 * is the one the host produces for every merged pull request, and a caller
 * acting on the word rather than the record deletes refs whose work landed.
 * The refusal names `merged-reported-closed` so the caller reads `mergedAt`.
 *
 * **`MERGED` without a merge record is refused too**, from the other side: the
 * state claims a landing the evidence does not carry, and `prHasLanded` reads
 * `mergedAt` rather than the word.
 *
 * **A draft cannot merge.** It is not asking for review, so a merge reported
 * against one is a reading of the wrong pull request.
 *
 * @param pr - the pull request, carrying the state it held and its merge record.
 * @param input - the state the host now reports, plus any readings.
 * @returns a decision carrying the move, or a refusal naming the gate that
 *   fired: `state-unrecognised`, `state-unchanged`, `state-terminal`,
 *   `state-unreachable`, `merged-reported-closed`, `merge-record-missing`,
 *   `draft-cannot-merge` or `precondition-unmet`.
 */
export const observePrState = (pr: Pr, input: ObservePrInput): TransitionResult => {
  const id = prId(pr.repo, pr.number);

  if (!known(input.to)) {
    return refuse(
      id,
      'state-unrecognised',
      `'${input.to}' is not a pull-request state — the three are ${PrStateSchema.options.join(', ')}.`,
    );
  }
  const to: PrState = input.to;

  // ASKED BEFORE THE MOVE, because the move is the thing it corrects. A merged
  // PR reporting `CLOSED` would otherwise pass as a legal `OPEN -> CLOSED` and
  // the landing would be lost in a word.
  if (to === 'CLOSED' && prHasLanded(pr)) {
    return refuse(
      id,
      'merged-reported-closed',
      `pull request ${id} merged on ${pr.mergedAt} and the host reports 'CLOSED' — that is what a merged pull request reports, so read 'mergedAt' rather than the state.`,
    );
  }

  if (to === 'MERGED' && !prHasLanded(pr)) {
    return refuse(
      id,
      'merge-record-missing',
      `pull request ${id} is reported 'MERGED' with no merge record — landing is read from 'mergedAt', and a state claiming what the record does not carry is not evidence.`,
    );
  }

  if (to === 'MERGED' && pr.draft) {
    return refuse(
      id,
      'draft-cannot-merge',
      `pull request ${id} is a draft — it is not asking for review, so a merge reported against it reads the wrong pull request.`,
    );
  }

  if (pr.state === to) {
    return refuse(id, 'state-unchanged', `pull request ${id} is already '${to}' — nothing moved.`);
  }

  if (NEXT[pr.state].length === 0) {
    return refuse(
      id,
      'state-terminal',
      `pull request ${id} is '${pr.state}' — neither end reopens on the host's word, and a reopened pull request arrives as a fresh reading.`,
    );
  }

  if (!NEXT[pr.state].includes(to)) {
    return refuse(
      id,
      'state-unreachable',
      `pull request ${id} cannot go '${pr.state}' -> '${to}' — from '${pr.state}' it may become ${NEXT[pr.state].join(' or ')}.`,
    );
  }

  const blocked = unmet(id, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', id, from: pr.state, to, landed: prHasLanded(pr) };
};
