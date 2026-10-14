import type { ClaimAnswer } from './claim.js';
import {
  runHalted,
  runRetryVerdict,
  slotRefusal,
  type RunStore,
  type SlotRefusalInput,
} from './fleet-run.js';
import { SPEC_PLACEHOLDER, specOf } from '../workflows/needs-design.js';
import type { PrLookup } from '../ports/host.js';

/**
 * Whether a plan's `## Spec` section carries no design work yet: absent, empty,
 * or still the placeholder. A section holding only a link to a `DESIGN-*.md`
 * file counts as written.
 *
 * @param text - the plan's full text.
 * @returns `true` when the section is empty.
 */
export const specIsEmpty = (text: string): boolean => {
  const body = specOf(text);
  return body === '' || body === SPEC_PLACEHOLDER;
};

/** What `designWork` answers: start a spec run, retry its PR, or do nothing. */
export type DesignWorkAnswer = 'write-spec' | 'open-pr' | 'none';

/** What `designWork` reads about one Design plan. */
export interface DesignWorkReadings {
  /** The plan's phase, as the default branch reads it. */
  readonly state: string;
  /** The plan's full text, at the default branch. */
  readonly text: string;
  /** `claimTip`'s answer for `idea/<slug>-spec` on origin. */
  readonly specRef: ClaimAnswer;
  /** Whether the plan's failure record under the current `Design:` commit reads `pr-not-opened`. */
  readonly prRetry: boolean;
}

/**
 * What a Design plan's spec needs from the fleet: `write-spec` for a plan with
 * an empty `## Spec` section and no claim on `idea/<slug>-spec`, `open-pr` for
 * a written spec whose last run failed to open a PR, `none` otherwise.
 *
 * Only a `design` plan is read; every other phase answers `none`. `unknown`
 * answers `none`: an unreadable ref must neither start a run nor record a
 * failure.
 *
 * @param readings - the plan's state, text and spec ref.
 * @returns the answer.
 */
export const designWork = (readings: DesignWorkReadings): DesignWorkAnswer => {
  if (readings.state !== 'design') return 'none';
  if (!specIsEmpty(readings.text)) return 'none';
  if (readings.specRef === 'absent') return 'write-spec';
  if (readings.specRef === 'work' && readings.prRetry) return 'open-pr';
  return 'none';
};

/** Why `specStart` starts no run. */
export type SpecRefusal =
  | 'off'
  | 'running'
  | 'declined'
  | 'halted'
  | 'stopped'
  | 'waiting'
  | 'queue-unread'
  | 'no-free-agent'
  | 'starved';

/** What `specStart` answers: start, `ask-host`, or the named reason it does not. */
export type SpecStartAnswer =
  | { readonly start: true }
  | { readonly start: false; readonly reason: 'ask-host' }
  | { readonly start: false; readonly reason: SpecRefusal };

/** A `work` spec ref this fleet did not start, read once per tip. */
export interface SpecOrphan {
  /** The claim commit this reading answered. */
  readonly tip: string;
  /** Whether the host found an open PR for the ref. */
  readonly hasPr: boolean;
}

/** The failure, declined and restart state `specStart` and `specRow` read, per plan. */
export interface DesignStore extends RunStore {
  /** The `Design:` commit and PR number of a plan a person has not yet restarted past. */
  readonly declined: Readonly<Record<string, { readonly commit: string; readonly pr: number }>>;
  /** The newest PR number a restart has already answered, per plan. */
  readonly answeredPr: Readonly<Record<string, number>>;
  /** The `Design:` commit of a plan with a pending restart mark. */
  readonly restart: Readonly<Record<string, string>>;
  /** An orphaned `work` ref's tip and PR reading, per plan. */
  readonly orphans: Readonly<Record<string, SpecOrphan>>;
}

/** What `specStart` reads. */
export interface SpecStartInput extends SlotRefusalInput {
  /** Whether `Auto-design` is on. */
  readonly autoDesign: boolean;
  /** Whether `Design command` is declared. */
  readonly command: boolean;
  /** The plan's slug. */
  readonly slug: string;
  /** The plan's current `Design:` commit. */
  readonly designCommit: string;
  /** The slugs with a spec run or a verify run this fleet started that is still going. */
  readonly going: ReadonlySet<string>;
  /** The persisted failure, declined and restart state. */
  readonly store: DesignStore;
  /** Epoch milliseconds. */
  readonly now: number;
}

/**
 * Decides whether a spec run of one Design plan may start, and names the
 * reason when it may not, from local readings only. The first refusal that
 * holds is the answer, in this order: `off` (no `Design command`, or
 * `Auto-design` off), `running` (a spec run or a verify
 * run is going), `declined`, `halted`, `stopped`, `waiting`, `queue-unread`,
 * `no-free-agent`, `starved` (without `Machine override`). `ask-host` when
 * none of these applies — the host read belongs to `specDeclined`.
 *
 * A plan with a pending restart mark under the current `Design:` commit passes
 * `Auto-design` off, `declined`, `halted`, `stopped` and `waiting` once; it does
 * not pass a missing `Design command`, `running` or the three slot refusals, so
 * the restarted run still needs a command and a free slot.
 *
 * @param input - the readings.
 * @returns the answer.
 */
export const specStart = (input: SpecStartInput): SpecStartAnswer => {
  const refuse = (reason: SpecRefusal): SpecStartAnswer => ({ start: false, reason });
  const restarting = input.store.restart[input.slug] === input.designCommit;
  if (!input.command) return refuse('off');
  if (!restarting && !input.autoDesign) return refuse('off');
  if (input.going.size > 0) return refuse('running');
  const declined = input.store.declined[input.slug];
  if (!restarting && declined !== undefined && declined.commit === input.designCommit) return refuse('declined');
  if (!restarting && runHalted(input.store)) return refuse('halted');
  const verdict = runRetryVerdict(input.store.failures[input.slug], input.designCommit, input.now);
  if (!restarting && verdict === 'stopped') return refuse('stopped');
  if (!restarting && verdict === 'waiting') return refuse('waiting');
  const slot = slotRefusal(input);
  if (slot !== null) return refuse(slot);
  return { start: false, reason: 'ask-host' };
};

/** What `specDeclined` answers about a Design plan's claim branch. */
export type SpecDeclinedAnswer = 'host-unknown' | 'declined' | 'pr-open' | 'start';

/**
 * Reads the host's answer for `idea/<slug>-spec`, after `specStart` answers
 * `ask-host`. A closed PR at or below `answeredPr` is one a person already
 * answered with a restart, so the restart wins over it and this answers
 * `start`; above it, the branch is `declined`. An open PR answers `pr-open`:
 * start nothing, record nothing.
 *
 * @param pr - the host's newest PR for the branch, or `'unknown'` where the
 *   host could not answer.
 * @param answeredPr - the PR number a restart has already answered, or `0`.
 * @returns the answer.
 */
export const specDeclined = (pr: PrLookup | 'unknown', answeredPr: number): SpecDeclinedAnswer => {
  if (pr === 'unknown') return 'host-unknown';
  if (pr === null) return 'start';
  if (pr.state === 'OPEN') return 'pr-open';
  return pr.number <= answeredPr ? 'start' : 'declined';
};

/** One row of *Working* or *Waiting on you* for a Design plan's spec run. */
export interface SpecRow {
  readonly kind: 'spec';
  readonly plan: string;
  /** What the row says, in one line; `''` for a going run. */
  readonly reason: string;
  /** The log of the failed run; `''` for a going run. */
  readonly log: string;
  /** The command that restarts the run by hand; `''` for a going run. */
  readonly restart: string;
  /** Whether this plan itself reads `stopped`. */
  readonly stopped: boolean;
  /** Whether the fleet starts no spec run of any plan. */
  readonly halted: boolean;
}

/**
 * The row of a Design plan's spec run: `working` for a going run,
 * `waiting-on-you` for a plan whose failure record carries the current
 * `Design:` commit or whose orphan record reads `no-pr`, `null` otherwise.
 *
 * @param slug - the plan slug.
 * @param designCommit - the plan's current `Design:` commit.
 * @param store - the persisted failure, declined, restart and orphan state.
 * @param log - the path of the failed run's log.
 * @param going - whether a spec run of this plan is going.
 * @param now - epoch milliseconds.
 * @returns the row, or `null`.
 */
export const specRow = (
  slug: string,
  designCommit: string,
  store: DesignStore,
  log: string,
  going: boolean,
  now: number,
): SpecRow | null => {
  if (going) {
    return { kind: 'spec', plan: slug, reason: '', log: '', restart: '', stopped: false, halted: false };
  }
  const halted = runHalted(store);
  const orphan = store.orphans[slug];
  if (orphan !== undefined && !orphan.hasPr) {
    return {
      kind: 'spec',
      plan: slug,
      reason: 'the spec branch has no pull request',
      log: '',
      restart: `plot-design.mjs restart ${slug}`,
      stopped: false,
      halted,
    };
  }
  const failure = store.failures[slug];
  if (failure === undefined || failure.reading !== designCommit) return null;
  const stopped = runRetryVerdict(failure, designCommit, now) === 'stopped';
  const parts = [`the spec run failed ${failure.count} time${failure.count === 1 ? '' : 's'}`];
  if (stopped) parts.push('the fleet stopped retrying this plan');
  if (halted) parts.push('the fleet is halted on spec run failures');
  return {
    kind: 'spec',
    plan: slug,
    reason: parts.join('; '),
    log,
    restart: `plot-design.mjs restart ${slug}`,
    stopped,
    halted,
  };
};
