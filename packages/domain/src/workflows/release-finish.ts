import { normalizeVersion } from '../entities/release.js';
import type { SprintState } from '../entities/sprint.js';
import { isRefusal, setSprintState } from '../transitions/sprint.js';
import {
  releaseOwed,
  releaseOwes,
  releaseScope,
  sprintClosed,
  type ReleaseScopePlan,
  type ReleaseScopeSprint,
} from '../rules/release-scope.js';
import type { ReleaseChangeset } from '../rules/release-prepare.js';
import { type Caller, type Outcome, decide, refuse } from './decision.js';

/**
 * Why `releaseFinish` refused. Each refusal writes nothing.
 *
 * `already-released` is the safe answer to a second run: every scope plan holds
 * its `Released:` record and every sprint of the release is closed.
 * `sprint-ambiguous` names every open sprint of the release when there is more
 * than one. `release-scope-mismatch` catches the sprint that moved on: no
 * sprint names the version this finish is booking, and an open sprint names a
 * different one. `sprint-unclosable` carries the sprint transition's own
 * refusal.
 */
export type ReleaseFinishRefusal =
  | 'unattended'
  | 'tag-absent'
  | 'sprint-ambiguous'
  | 'release-scope-mismatch'
  | 'plan-unbookable'
  | 'sprint-unclosable'
  | 'already-released';

/** One plan file, as the finish reads it. */
export interface ScopePlan extends ReleaseScopePlan {
  /** The plan's type. Every type is booked, `docs` and `infra` included. */
  readonly type: string;
}

/** A sprint file, active or closed. */
export interface FinishSprint extends ReleaseScopeSprint {
  /** The sprint file's path, relative to the repository root. */
  readonly file: string;
  /** The active index entry that names the file, relative to the repository root; `''` where the active index names none. */
  readonly link: string;
}

/** What `releaseFinish` reads. */
export interface ReleaseFinishReadings {
  /** Who is asking; neither an unattended caller nor fleetd finishes a release. */
  readonly caller: Caller;
  /** The version read from the freshly fetched default branch's `package.json`. */
  readonly version: string;
  /** Whether the tag for that version exists after the bounded wait. */
  readonly tagExists: boolean;
  /** The tag's date as `YYYY-MM-DD`, or `''` where unread; see {@link releaseScope}. */
  readonly tagDate: string;
  /** Every plan file the entry could read; an unreadable one carries `file: ''`. */
  readonly plans: readonly ScopePlan[];
  /**
   * The changesets the release merge removed, with the plan each names. `'unaskable'` where
   * they could not be read; an empty list is an answer, not a failed read.
   */
  readonly shipped: readonly ReleaseChangeset[] | 'unaskable';
  /** Every sprint file, active or closed. */
  readonly sprints: readonly FinishSprint[];
}

/** What the finish was asked to record. */
export interface ReleaseFinishInput {
  /** The date to record, ISO-8601. */
  readonly on: string;
}

/** The close of a sprint, as the sprint transition decided it. */
export interface FinishSprintClose {
  /** The sprint's slug. */
  readonly slug: string;
  /** The sprint file to write `State: Closed` and `Actual End:` into. */
  readonly file: string;
  /** The active index entry the same commit removes; `''` where the active index names none. */
  readonly link: string;
  /** The date the transition records as `Actual End:`. */
  readonly actualEnd: string;
}

/** What a passing finish reports beyond its writes. */
export interface ReleaseFinishDetail {
  /** The version, canonically spelled. */
  readonly version: string;
  /** The slugs this run books as Released. */
  readonly booked: readonly string[];
  /** The sprint this run closes, or `null` where none closes. */
  readonly closeSprint: FinishSprintClose | null;
  /**
   * Lines naming what the finish did not book: Delivered plans outside the sprint that no
   * shipped changeset names, named plans that are not Delivered, and `shipped-unread`.
   */
  readonly notes: readonly string[];
}

/**
 * Decides what finishing a merged release writes.
 *
 * The scope is {@link releaseScope} over every sprint file: each sprint whose
 * `Release:` names the version, active or closed, and each plan a shipped
 * changeset names. Refuses `unattended` first, then `tag-absent`, then
 * `sprint-ambiguous` when more than one open sprint is in scope, then
 * `release-scope-mismatch` when no sprint is in scope and an open sprint names
 * another `Release:`, then `plan-unbookable` for a sprint plan whose file is
 * absent or whose phase is neither `delivered` nor `released`. An open sprint
 * naming another version is otherwise ignored, and a closed sprint stays
 * closed. The one open sprint in scope goes through `setSprintState` to
 * `Closed`, and its refusal stops the finish as `sprint-unclosable`. The plans
 * booked are {@link releaseOwed}'s. A named plan that is not Delivered or has
 * no file, and a Delivered plan nothing in scope names, is named in `notes`;
 * none of them refuses. `shipped` of `'unaskable'` books the sprint scope only
 * and adds a `shipped-unread` note. When nothing remains to book and no sprint
 * closes, refuses `already-released`. Otherwise one commit and one push book
 * every owed plan, and the commit names the sprint file and its active index
 * entry when the sprint closes in it.
 *
 * @param readings - the caller, the version, the tag, the plans, the changesets and the sprints.
 * @param input - the date to record.
 * @returns a decision naming every write, or the first refusal.
 */
export const releaseFinish = (
  readings: ReleaseFinishReadings,
  input: ReleaseFinishInput,
): Outcome<ReleaseFinishDetail, ReleaseFinishRefusal> => {
  const no = (reason: ReleaseFinishRefusal, detail: string) => refuse('release-finish', reason, detail);
  if (readings.caller === 'unattended' || readings.caller === 'fleetd') {
    return no('unattended', 'a release needs a person. An unattended caller does not finish one, and fleetd gets no exception here.');
  }
  const version = normalizeVersion(readings.version);
  if (!readings.tagExists) {
    return no('tag-absent', `tag ${version} does not exist yet. Nothing is written; run the finish again once publish has tagged it.`);
  }
  const scope = releaseScope(version, readings.tagDate, readings.sprints, readings.shipped);
  const openInScope = scope.sprints.filter((s) => !sprintClosed(s));
  if (openInScope.length > 1) {
    const named = openInScope.map((s) => s.link || s.file).join(', ');
    return no('sprint-ambiguous', `${openInScope.length} open sprints name ${version}: ${named}. Close all but one with /plot-sprint, then run the finish again. Nothing is written.`);
  }
  if (scope.sprints.length === 0) {
    const moved = readings.sprints.find((s) => !sprintClosed(s) && s.release.trim() !== '');
    if (moved !== undefined) {
      return no(
        'release-scope-mismatch',
        `no sprint names Release: ${version}, and the open sprint ${moved.link || moved.file} names Release: ${moved.release.trim()}. Nothing is written; fix the Release field of ${version}'s own sprint, then run the finish again.`,
      );
    }
  }
  const bySlug = new Map(readings.plans.map((p) => [p.slug, p]));
  const unbookable = scope.sprintSlugs
    .map((slug) => bySlug.get(slug) ?? { slug, file: '', type: '', phase: 'none', releasedRecord: '' })
    .filter((p) => p.file === '' || (p.phase !== 'delivered' && p.phase !== 'released'));
  if (unbookable.length > 0) {
    const named = unbookable
      .map((p) => `${p.slug} (${p.file === '' ? 'no plan file' : `phase ${p.phase}`})`)
      .join(', ');
    return no('plan-unbookable', `${unbookable.length} scope plan(s) cannot be booked as Released: ${named}. Nothing is written.`);
  }
  const notes: string[] = [];
  if (readings.shipped === 'unaskable') {
    notes.push('shipped-unread: the release merge\'s changesets could not be read, so only the sprint scope is booked.');
  } else {
    const skipped = scope.named
      .filter((slug) => !releaseOwes(bySlug.get(slug), false))
      .flatMap((slug) => {
        const p = bySlug.get(slug);
        if (p === undefined || p.file === '') return [`${slug} (no plan file)`];
        return p.phase === 'delivered' ? [] : [`${slug} (phase ${p.phase})`];
      });
    if (skipped.length > 0) notes.push(`named by a shipped changeset and not booked: ${skipped.join(', ')}.`);
  }
  const owed = releaseOwed(scope, readings.plans);
  const inScope = new Set([...scope.sprintSlugs, ...scope.named]);
  const unbooked = readings.plans
    .filter((p) => p.file !== '' && p.phase === 'delivered' && p.releasedRecord.trim() === '' && !inScope.has(p.slug))
    .map((p) => p.slug);
  if (unbooked.length > 0) notes.push(`Delivered outside the sprint, named by no shipped changeset, not booked: ${unbooked.join(', ')}.`);
  const pending = owed.map((slug) => bySlug.get(slug)!);
  const open = openInScope[0] ?? null;
  let closeSprint: FinishSprintClose | null = null;
  if (open !== null) {
    const closed = setSprintState(
      {
        slug: open.slug,
        title: open.slug,
        // The file's word, unparsed: `setSprintState` refuses one that is not a state.
        state: open.state.trim() as SprintState,
        start: open.start,
        // A move to `Closed` reads the state and the start date and nothing else.
        plannedEnd: '',
        actualEnd: null,
        release: '',
        goal: '',
        items: [],
      },
      { to: 'Closed', on: input.on },
    );
    if (isRefusal(closed)) {
      return no('sprint-unclosable', `${closed.reason}: ${closed.detail} Nothing is written.`);
    }
    closeSprint = { slug: open.slug, file: open.file, link: open.link, actualEnd: String(closed.actualEnd) };
  }
  if (pending.length === 0 && closeSprint === null) {
    return no('already-released', `every scope plan holds its Released record for ${version} and the sprint is closed. Nothing is written.`);
  }
  const writes = pending.flatMap((p) => [
    { kind: 'plan-phase' as const, file: p.file, phase: 'Released' as const },
    { kind: 'plan-record' as const, file: p.file, field: 'Released' as const, value: `${input.on}, ${version}` },
  ]);
  const paths = [...pending.map((p) => p.file), ...(closeSprint === null ? [] : [closeSprint.file, closeSprint.link])];
  return decide(
    'release-finish',
    [
      ...writes,
      { kind: 'commit', message: `plot: record ${version}`, paths },
      { kind: 'push', branch: `plot/release-${version}`, onto: 'default' },
    ],
    { version, booked: pending.map((p) => p.slug), closeSprint, notes },
  );
};
