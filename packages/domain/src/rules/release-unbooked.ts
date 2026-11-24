import { normalizeVersion } from '../entities/release.js';
import type { Finding } from '../entities/finding.js';
import type { ReleaseChangeset } from './release-prepare.js';
import {
  releaseOwed,
  releaseScope,
  sprintClosed,
  type ReleaseScopePlan,
  type ReleaseScopeSprint,
} from './release-scope.js';

/** The newest release tag, as read; `'none'` where the repository holds no release tag. */
export type ReleaseTagReading = { readonly tag: string; readonly date: string } | 'none' | 'unaskable';

/** What {@link releaseUnbooked} reads. Each read is `'unaskable'` where it failed. */
export interface ReleaseUnbookedReadings {
  /** The newest `vN.N.N` tag and its date as `YYYY-MM-DD`. */
  readonly tag: ReleaseTagReading;
  /** Every sprint file, active or closed. */
  readonly sprints: readonly ReleaseScopeSprint[] | 'unaskable';
  /** Every plan file. */
  readonly plans: readonly ReleaseScopePlan[] | 'unaskable';
  /** The changesets the tag's merge removed, with the plan each names. */
  readonly shipped: readonly ReleaseChangeset[] | 'unaskable';
}

/** A release whose finish is still owed. */
export interface ReleaseUnbooked {
  /** The release version, canonically `vN.N.N`. */
  readonly version: string;
  /** The slugs of the plans that still owe their `Released:` record. */
  readonly plans: readonly string[];
  /** The slug of a sprint of the release that is not closed, or `null`. */
  readonly sprintOpen: string | null;
}

/** The answer of {@link releaseUnbooked}. */
export type ReleaseUnbookedAnswer = ReleaseUnbooked | 'none' | 'unaskable';

/**
 * Names what the newest release still owes.
 *
 * The scope is {@link releaseScope}: every sprint whose `Release:` names the
 * tag's version, active or closed, and every plan a removed changeset names,
 * whatever the plan's type. A plan is owed as {@link releaseOwed} decides.
 *
 * @param readings - the newest tag, the sprints, the plans and the removed changesets.
 * @returns the version, the owed plans and an open sprint of the release;
 *   `'none'` where no release tag exists, or where no plan is owed and every
 *   sprint of the release is closed; `'unaskable'` where any read failed.
 */
export const releaseUnbooked = (readings: ReleaseUnbookedReadings): ReleaseUnbookedAnswer => {
  const { tag, sprints, plans, shipped } = readings;
  if (tag === 'unaskable' || sprints === 'unaskable' || plans === 'unaskable' || shipped === 'unaskable') {
    return 'unaskable';
  }
  if (tag === 'none') return 'none';
  const version = normalizeVersion(tag.tag);
  const scope = releaseScope(version, tag.date, sprints, shipped);
  const owed = releaseOwed(scope, plans);
  const sprintOpen = scope.sprints.find((s) => !sprintClosed(s))?.slug ?? null;
  return owed.length === 0 && sprintOpen === null ? 'none' : { version, plans: owed, sprintOpen };
};

/** The branch slot of every `release unbooked` finding: one per repository, whatever the version. */
export const RELEASE_UNBOOKED_BRANCH = 'release';

/** The publishes and retractions that bring the channel in line with one reading. */
export interface ReleaseUnbookedDiff {
  readonly publish: readonly Finding[];
  readonly clear: readonly Finding[];
}

/**
 * The finding that carries one `releaseUnbooked` answer, and the change the channel needs.
 *
 * An owed release publishes `release unbooked` under the `ReleaseMonitor`,
 * with the version, the plans and the open sprint as evidence; a held finding
 * with the same evidence is not published again. `'none'` retracts a held
 * finding. `'unaskable'` publishes and retracts nothing.
 *
 * @param held - the findings the channel holds.
 * @param answer - the rule's answer.
 * @param now - the current time, ISO-8601.
 * @returns the publishes and the retractions.
 */
export const releaseUnbookedDiff = (
  held: readonly Finding[],
  answer: ReleaseUnbookedAnswer,
  now: string,
): ReleaseUnbookedDiff => {
  if (answer === 'unaskable') return { publish: [], clear: [] };
  const current = held.find(
    (f) => f.monitor === 'ReleaseMonitor' && f.branch === RELEASE_UNBOOKED_BRANCH && f.finding !== 'clear',
  );
  if (answer === 'none') {
    return current === undefined
      ? { publish: [], clear: [] }
      : {
          publish: [],
          clear: [
            {
              monitor: 'ReleaseMonitor',
              branch: RELEASE_UNBOOKED_BRANCH,
              worktree: '',
              finding: 'clear',
              since: now,
              evidence: `${current.finding} no longer holds`,
              measuredAt: now,
            },
          ],
        };
  }
  const evidence = releaseUnbookedEvidence(answer);
  if (current?.evidence === evidence) return { publish: [], clear: [] };
  return {
    publish: [
      {
        monitor: 'ReleaseMonitor',
        branch: RELEASE_UNBOOKED_BRANCH,
        worktree: '',
        finding: 'release unbooked',
        since: current?.since ?? now,
        evidence,
        measuredAt: now,
      },
    ],
    clear: [],
  };
};

/**
 * The evidence line of a `release unbooked` finding.
 *
 * @param answer - an owed release.
 * @returns `<version>: <n> plan(s) unbooked (<slugs>)`, with `; sprint <slug> open` where a sprint is open.
 */
export const releaseUnbookedEvidence = (answer: ReleaseUnbooked): string =>
  `${answer.version}: ${answer.plans.length} plan(s) unbooked${answer.plans.length === 0 ? '' : ` (${answer.plans.join(', ')})`}${answer.sprintOpen === null ? '' : `; sprint ${answer.sprintOpen} open`}`;
