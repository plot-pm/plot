import { normalizeVersion } from '../entities/release.js';
import type { SprintState } from '../entities/sprint.js';
import { isRefusal, setSprintState } from '../transitions/sprint.js';
import { type Caller, type Outcome, decide, refuse } from './decision.js';

/**
 * Why `releaseFinish` refused. Each refusal writes nothing.
 *
 * `already-released` is the safe answer to a second run: every scope plan holds
 * its `Released:` record and the sprint is closed. `sprint-ambiguous` names
 * every sprint the active index holds when it holds more than one, and
 * `sprint-unclosable` carries the sprint transition's own refusal.
 */
export type ReleaseFinishRefusal =
  | 'unattended'
  | 'tag-absent'
  | 'sprint-ambiguous'
  | 'plan-unbookable'
  | 'sprint-unclosable'
  | 'already-released';

/** One plan in the release's scope, as the finish reads it. */
export interface ScopePlan {
  /** The plan's slug. */
  readonly slug: string;
  /** The plan file's path, relative to the repository root; `''` where the file is absent. */
  readonly file: string;
  /** The plan's type. Every type is booked, `docs` and `infra` included. */
  readonly type: string;
  /** The plan's `State:`, lower case. */
  readonly phase: string;
  /** The `Released:` record as written, or `''`. */
  readonly releasedRecord: string;
}

/** A sprint the active index holds. */
export interface FinishSprint {
  /** The sprint's slug. */
  readonly slug: string;
  /** The sprint file's path, relative to the repository root. */
  readonly file: string;
  /** The active index entry that names the file, relative to the repository root. */
  readonly link: string;
  /** The `State:` (or legacy `Phase:`) value as the file spells it. */
  readonly state: string;
  /** The `Start:` date as the file states it, or `''`. */
  readonly start: string;
}

/** What `releaseFinish` reads. */
export interface ReleaseFinishReadings {
  /** Who is asking; neither an unattended caller nor fleetd finishes a release. */
  readonly caller: Caller;
  /** The version read from the freshly fetched default branch's `package.json`. */
  readonly version: string;
  /** Whether the tag for that version exists after the bounded wait. */
  readonly tagExists: boolean;
  /** The plans of the active sprint's scope, struck items excluded; empty unless exactly one sprint is active. */
  readonly scope: readonly ScopePlan[];
  /** Every sprint the active index holds. The scope is read from the only one. */
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
  /** The active index entry the same commit removes. */
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
}

/**
 * Decides what finishing a merged release writes.
 *
 * Refuses `unattended` first, then `tag-absent`, then `sprint-ambiguous` when
 * the active index holds more than one sprint, then `plan-unbookable` for a
 * scope plan whose file is absent or whose phase is neither `delivered` nor
 * `released`. An active sprint that is not closed goes through
 * `setSprintState` to `Closed`, and its refusal stops the finish as
 * `sprint-unclosable`. A plan already holding a `Released:` record is left
 * alone. When nothing remains to book and no sprint closes, refuses
 * `already-released`. Otherwise one commit and one push book every remaining
 * scope plan, and the commit names the sprint file and its active index entry
 * when the sprint closes in it.
 *
 * @param readings - the caller, the version, the tag, the scope and the active sprints.
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
  if (readings.sprints.length > 1) {
    const named = readings.sprints.map((s) => s.link).join(', ');
    return no('sprint-ambiguous', `the active sprint index holds ${readings.sprints.length} sprints: ${named}. Close all but one with /plot-sprint, then run the finish again. Nothing is written.`);
  }
  const unbookable = readings.scope.filter(
    (p) => p.file === '' || (p.phase !== 'delivered' && p.phase !== 'released'),
  );
  if (unbookable.length > 0) {
    const named = unbookable
      .map((p) => `${p.slug} (${p.file === '' ? 'no plan file' : `phase ${p.phase}`})`)
      .join(', ');
    return no('plan-unbookable', `${unbookable.length} scope plan(s) cannot be booked as Released: ${named}. Nothing is written.`);
  }
  const pending = readings.scope.filter((p) => p.releasedRecord.trim() === '');
  const open = readings.sprints.find((s) => s.state.trim().toLowerCase() !== 'closed') ?? null;
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
    { version, booked: pending.map((p) => p.slug), closeSprint },
  );
};
