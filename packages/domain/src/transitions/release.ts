import { ReleaseStateSchema, type Release, type ReleaseState } from '../entities/release.js';
import { normalizeVersion } from '../entities/version.js';

/*
 * A RELEASE'S STATE IS DERIVED FROM ITS TAG — `entities/release.ts:8`: *"Derived,
 * never stored: a release has a life before its tag exists"*. So a transition
 * here is a VERDICT on a tag that was cut, and carries nothing to write into a
 * file.
 *
 * A SHIPPED TAG IS IMMUTABLE, and that is the whole of the terminal refusal.
 * The declaration says *"never backwards: a shipped tag is immutable"* — a
 * version that needs changing gets a new version, because the tag people
 * already fetched cannot be made to mean something else.
 *
 * THE CHANNEL IS NOT A STAGE. `ReleaseChannelSchema` is declared a
 * classification for a reason `entities/release.ts:17` states: *"An rc does not
 * become a release; a release tag is cut alongside it."* So `candidate` is
 * about whether a checklist is open, and `rc` is about which kind of tag was
 * cut — two different questions, and this file refuses to conflate them.
 */

/**
 * The states, in the order a version passes through them.
 *
 * Re-exported as a value because a renderer groups by state and needs the
 * order; `ReleaseStateSchema.options` carries the same three and is the source.
 * **The states are not redeclared** — `entities/release.ts:13` owns them.
 */
export const RELEASE_LIFECYCLE: readonly ReleaseState[] = ['planned', 'candidate', 'shipped'];

/**
 * Which states each state may become.
 *
 * `planned -> shipped` is legal and is not a shortcut: a release cut without a
 * candidate is what every patch does. The candidate stage exists for a version
 * carrying an RC checklist, and a version with none never enters it.
 *
 * `shipped` leads nowhere. The tag is immutable, so a version needing a change
 * gets a new version rather than a new meaning.
 *
 * There is no way back from `candidate`. Abandoning a candidate does not return
 * the version to `planned` — the rc tag exists and was fetched, so the next
 * attempt is a new candidate at a new version.
 */
const NEXT: Readonly<Record<ReleaseState, readonly ReleaseState[]>> = {
  planned: ['candidate', 'shipped'],
  candidate: ['shipped'],
  shipped: [],
};

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape the other transition files use, and for the same reason: a
 * release is a git tag, and the domain reaches no repository.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a release transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-unrecognised'
  | 'state-terminal'
  | 'state-unreachable'
  | 'state-unchanged'
  | 'version-unreadable'
  | 'tag-missing'
  | 'checklist-missing'
  | 'channel-mismatch'
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
  /** The version the refusal is about. */
  readonly version: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that holds: the state the tag now supports.
 *
 * Carries nothing to write. The state is derived from the tag, so a caller acts
 * by cutting one rather than by recording this answer.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The version, canonically `vN.N.N`. */
  readonly version: string;
  /** The state it held. */
  readonly from: ReleaseState;
  /** The state it now holds. */
  readonly to: ReleaseState;
  /** Whether the version is now immutable. */
  readonly immutable: boolean;
}

/** What a release transition answers: the state, or the gate that stopped it. */
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

const refuse = (version: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  version,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param version - the version the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (version: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    version,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (state: string): state is ReleaseState =>
  (ReleaseStateSchema.options as readonly string[]).includes(state);

/** What `observeReleaseState` needs beyond the release. */
export interface ObserveReleaseInput {
  /** The state now derived from the tag. */
  to: string;
  /** Readings a caller measured, such as whether the tag could be listed. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a release may be observed to hold a given state.
 *
 * Callable alone, because a board must know whether to offer the move before
 * anyone takes it. It is not a permission: {@link observeReleaseState}
 * re-checks.
 *
 * @param release - the release to test.
 * @param to - the state it would be observed in.
 * @returns true when the gates would pass.
 */
export const releaseStateObservable = (release: Release, to: string): boolean =>
  !isRefusal(observeReleaseState(release, { to }));

/**
 * Judges a change of release state that a tag has already made true.
 *
 * The version is canonicalised by {@link normalizeVersion}, which prefixes `v`
 * and answers `''` for an empty string. It does NOT validate the shape, so
 * `version-unreadable` fires on an unnamed release and not on a malformed one.
 *
 * **A state past `planned` needs the tag it is derived from.** `date` and
 * `commit` are null while planned and non-null once a tag exists, so a caller
 * reporting `candidate` or `shipped` with neither has read a tag that is not
 * there.
 *
 * **A candidate needs its checklist.** That is what the stage is for: a version
 * with no RC checklist never enters it and goes straight to `shipped`.
 *
 * **The channel must agree with the state.** An `rc` tag cannot be `shipped`
 * and a `release` tag cannot be a `candidate` — the channel says which kind of
 * tag was cut, and a release tag is cut alongside its rc rather than out of it.
 *
 * @param release - the release, carrying the state it held and its tag readings.
 * @param input - the state now derived, plus any readings.
 * @returns a decision carrying the move, or a refusal naming the gate that
 *   fired: `state-unrecognised`, `state-unchanged`, `state-terminal`,
 *   `state-unreachable`, `version-unreadable`, `tag-missing`,
 *   `checklist-missing`, `channel-mismatch` or `precondition-unmet`.
 */
export const observeReleaseState = (
  release: Release,
  input: ObserveReleaseInput,
): TransitionResult => {
  const version = normalizeVersion(release.version);
  if (version === '') {
    return refuse(
      release.version,
      'version-unreadable',
      `a release names no version — the tag is the identity, and a release identified by nothing cannot be judged.`,
    );
  }

  if (!known(input.to)) {
    return refuse(
      version,
      'state-unrecognised',
      `'${input.to}' is not a release state — the three are ${ReleaseStateSchema.options.join(', ')}.`,
    );
  }
  const to: ReleaseState = input.to;

  if (release.state === to) {
    return refuse(version, 'state-unchanged', `release '${version}' is already '${to}' — nothing moved.`);
  }

  if (NEXT[release.state].length === 0) {
    return refuse(
      version,
      'state-terminal',
      `release '${version}' has shipped — the tag is immutable, so a change gets a new version rather than a new meaning.`,
    );
  }

  if (!NEXT[release.state].includes(to)) {
    return refuse(
      version,
      'state-unreachable',
      `release '${version}' cannot go '${release.state}' -> '${to}' — from '${release.state}' it may become ${NEXT[release.state].join(' or ')}.`,
    );
  }

  if (release.date === null || release.commit === null) {
    return refuse(
      version,
      'tag-missing',
      `release '${version}' cannot become '${to}' with no tag — the state is derived from the tag, and 'planned' is what a version with none is.`,
    );
  }

  if (to === 'candidate' && release.checklist === null) {
    return refuse(
      version,
      'checklist-missing',
      `release '${version}' cannot become a candidate with no RC checklist — that is what the stage is for, and a version with none ships directly.`,
    );
  }

  if (to === 'shipped' && release.channel === 'rc') {
    return refuse(
      version,
      'channel-mismatch',
      `release '${version}' is an 'rc' tag and cannot ship — a release tag is cut alongside its candidate rather than out of it.`,
    );
  }

  if (to === 'candidate' && release.channel === 'release') {
    return refuse(
      version,
      'channel-mismatch',
      `release '${version}' is a 'release' tag and cannot be a candidate — the channel says which kind of tag was cut.`,
    );
  }

  const blocked = unmet(version, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', version, from: release.state, to, immutable: to === 'shipped' };
};
