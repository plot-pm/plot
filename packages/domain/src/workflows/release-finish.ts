import { normalizeVersion } from '../entities/release.js';
import { type Caller, type Outcome, decide, refuse } from './decision.js';

/**
 * Why `releaseFinish` refused. Each refusal writes nothing.
 *
 * `already-released` is the safe answer to a second run: every scope plan holds
 * its `Released:` record and the sprint is closed.
 */
export type ReleaseFinishRefusal = 'unattended' | 'tag-absent' | 'plan-unbookable' | 'already-released';

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

/** The sprint that closes with the release, or `null` where the scope names none. */
export interface FinishSprint {
  /** The sprint's slug. */
  readonly slug: string;
  /** The sprint file's path, relative to the repository root. */
  readonly file: string;
  /** The sprint's lifecycle state, lower case. */
  readonly state: string;
}

/** What `releaseFinish` reads. */
export interface ReleaseFinishReadings {
  /** Who is asking; neither an unattended caller nor fleetd finishes a release. */
  readonly caller: Caller;
  /** The version read from the release branch's `package.json`. */
  readonly version: string;
  /** Whether the tag for that version exists after the bounded wait. */
  readonly tagExists: boolean;
  /** The plans of the active sprint's scope, struck items excluded. */
  readonly scope: readonly ScopePlan[];
  /** The sprint the scope was read from, or `null`. */
  readonly sprint: FinishSprint | null;
}

/** What the finish was asked to record. */
export interface ReleaseFinishInput {
  /** The date to record, ISO-8601. */
  readonly on: string;
}

/** What a passing finish reports beyond its writes. */
export interface ReleaseFinishDetail {
  /** The version, canonically spelled. */
  readonly version: string;
  /** The slugs this run books as Released. */
  readonly booked: readonly string[];
  /** The slug of the sprint this run closes, or `null` where none closes. */
  readonly closeSprint: string | null;
}

/**
 * Decides what finishing a merged release writes.
 *
 * Refuses `unattended` first, then `tag-absent`, then `plan-unbookable` for a
 * scope plan whose file is absent or whose phase is neither `delivered` nor
 * `released`. A plan already holding a `Released:` record is left alone. When
 * nothing remains to book and the sprint is closed or absent, refuses
 * `already-released`. Otherwise one commit and one push book every remaining
 * scope plan, and the commit names the sprint file when the sprint closes in it.
 * The sprint's `State:` edit is the caller's, made through the sprint transition.
 *
 * @param readings - the caller, the version, the tag, the scope and the sprint.
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
  const closeSprint = readings.sprint !== null && readings.sprint.state !== 'closed' ? readings.sprint : null;
  if (pending.length === 0 && closeSprint === null) {
    return no('already-released', `every scope plan holds its Released record for ${version} and the sprint is closed. Nothing is written.`);
  }
  const writes = pending.flatMap((p) => [
    { kind: 'plan-phase' as const, file: p.file, phase: 'Released' as const },
    { kind: 'plan-record' as const, file: p.file, field: 'Released' as const, value: `${input.on}, ${version}` },
  ]);
  const paths = [...pending.map((p) => p.file), ...(closeSprint === null ? [] : [closeSprint.file])];
  return decide(
    'release-finish',
    [
      ...writes,
      { kind: 'commit', message: `plot: record ${version}`, paths },
      { kind: 'push', branch: `plot/release-${version}`, onto: 'default' },
    ],
    { version, booked: pending.map((p) => p.slug), closeSprint: closeSprint === null ? null : closeSprint.slug },
  );
};
