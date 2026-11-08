import { FleetReadingSchema, type FleetReading } from '../entities/fleet.js';
import { readingValue, type PlanEntry, type RepoSnapshot } from '../entities/snapshot.js';
import type { BranchDatesValue, QuestionsValue, WalkValue } from '../entities/view-readings.js';
import { answered } from '../port-result.js';
import { branchUrlBase } from '../rules/branch-url.js';
import { mapsOfRows, type PrRecord } from '../rules/pr-maps.js';
import { assemblePlanWalk, fleetReading } from './plan-walk-assembly.js';
import type { BranchStageReadings } from './plan-walk-branches.js';
import type { DeskStageReadings } from './plan-walk-desks.js';
import type { Estate } from './plan-walk-estate.js';

/** What the board's cache entry holds, derived from one snapshot. `unknown` where a reading it needs is not `read`. */
export interface BoardView {
  /** The pulse, as `fleetReading` assembles it from the walk's readings. */
  pulse: FleetReading | 'unknown';
  /** When the walk's readings were read, epoch ms; null where they were not. */
  at: number | null;
  /** When the walk last read a fetched ref, epoch ms: `at` where its fetch succeeded, otherwise null. */
  fetchedAt: number | null;
  /** Branch → minutes since its tip commit, measured at `now`. */
  ages: Map<string, number | null> | 'unknown';
  /** Branch → its tip commit's epoch ms. */
  tipAt: Map<string, number | null> | 'unknown';
  /** The branch-URL prefix of the walk's `origin` URL. */
  branchUrlBase: string | 'unknown';
  /** Plan basename → approval date, epoch ms, for the plans the pulse lists. */
  approvedAt: Map<string, number> | 'unknown';
  /** Idea branch → the plan file it carries. */
  ideaPlans: Map<string, string> | 'unknown';
  /** Release branch → the version its `package.json` names. */
  versions: Map<string, string> | 'unknown';
  /** Remote branches with commits the default branch lacks. */
  unmerged: Set<string> | 'unknown';
  /** The subset of `unmerged` whose only commits are claim markers. */
  claimOnly: Set<string> | 'unknown';
  /** Branch → what its desk's marker asks. */
  questions: Map<string, QuestionsValue[string]> | 'unknown';
  /** Open PRs by head branch; null where the PR rows are not read. */
  prs: Map<string, PrRecord> | null;
  /** Every PR by number; null where the PR rows are not read. */
  prsByNumber: Map<number, PrRecord> | null;
  /** One ranked PR per head branch; null where the PR rows are not read. */
  prsByHead: Map<string, PrRecord> | null;
}

/** What the walk read beside its stages, for the header of the pulse. */
export interface WalkHeader {
  main: string;
  readRef: string;
  localHead: string;
  fetchFailed: boolean;
  fetchError: string;
  planDir: string;
  mergeDetect: string;
  nowSeconds: number;
}

/**
 * The `walk` reading of the plan walk's stage answers.
 *
 * @param estate - the estate stage's answer; its plan records go to the `plans` reading.
 * @param branches - the branch stage's answer.
 * @param desks - the desk stage's answer; each desk's files and worker go to `deskFiles` and `workers`.
 * @param conflicts - each branch whose conflicts were read, to its conflicting paths.
 * @param header - the checkout facts the pulse's header carries.
 * @returns the value to record under `walk`.
 */
export const walkValueOf = (
  estate: Estate,
  branches: BranchStageReadings,
  desks: DeskStageReadings,
  conflicts: ReadonlyMap<string, readonly string[]>,
  header: WalkHeader,
): WalkValue => ({
  header: { ...header },
  estate: {
    mainSha: estate.mainSha,
    source: estate.source ?? 'ref',
    blobs: estate.plans.map(({ blob }) => ({ ...blob })),
    indexes: estate.indexes.map((link) => ({ ...link })),
    dangling: [...estate.dangling],
  },
  branches: {
    mainSha: branches.mainSha,
    backend: branches.backend,
    origin: branches.origin,
    hostReach: branches.hostReach,
    merges: branches.merges.map((merge) => ({ ...merge })),
    added: Object.fromEntries(branches.added),
    branches: branches.branches.map((b) => ({ ...b })),
    ...(branches.listing === undefined ? {} : { listing: branches.listing }),
  },
  desks: {
    mainSha: desks.mainSha,
    desks: desks.desks.map(({ branch, worktree, locked, unpushed, quietSeconds, dirty }) => ({
      branch,
      worktree,
      locked,
      unpushed,
      quietSeconds,
      dirty,
    })),
  },
  conflicts: Object.fromEntries(conflicts),
});

/**
 * Each branch's age and tip time from its tip's commit time.
 *
 * @param dates - each branch's tip commit time, epoch seconds.
 * @param nowMs - the clock the ages are measured from, epoch ms.
 * @returns minutes since the tip, never below 0, and the tip's epoch ms.
 */
export const branchAgesOf = (
  dates: BranchDatesValue,
  nowMs: number,
): { ages: Map<string, number | null>; tipAt: Map<string, number | null> } => {
  const ages = new Map<string, number | null>();
  const tipAt = new Map<string, number | null>();
  for (const { branch, committedAt } of dates) {
    ages.set(branch, Math.max(0, Math.round((nowMs / 1000 - committedAt) / 60)));
    tipAt.set(branch, Math.round(committedAt * 1000));
  }
  return { ages, tipAt };
};

/**
 * The approval date an `Approved:` record names.
 *
 * @param raw - the record's text, such as `2026-11-08, Jan Wloka, plan-PR #3278 merged`.
 * @returns midnight UTC of its leading date, epoch ms; null where it starts with no date.
 */
export const approvalDateOf = (raw: string): number | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  if (!m) return null;
  const at = Date.parse(`${m[1]}T00:00:00Z`);
  return Number.isNaN(at) ? null : at;
};

const baseOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/**
 * Assembles the pulse from the walk's readings.
 *
 * @returns the pulse and the plan records it was assembled from, or `unknown`
 *   where a plan or desk the walk names has no reading, or the assembly fails.
 * @throws where the assembled document is not a pulse.
 */
const pulseOf = (
  walk: WalkValue,
  plans: RepoSnapshot['readings']['plans'],
  deskFiles: RepoSnapshot['readings']['deskFiles'],
  workers: RepoSnapshot['readings']['workers'],
): { pulse: FleetReading; records: readonly PlanEntry[] } | 'unknown' => {
  const records = readingValue(plans);
  const files = readingValue(deskFiles);
  const processes = readingValue(workers);
  if (records === 'unknown' || files === 'unknown' || processes === 'unknown') return 'unknown';
  if (records.value.records.length !== walk.estate.blobs.length) return 'unknown';
  const desks = [];
  for (const desk of walk.desks.desks) {
    const held = files.value[desk.worktree];
    const process = processes.value[desk.worktree];
    if (held === undefined || process === undefined) return 'unknown';
    desks.push({ ...desk, desk: held, process });
  }
  const estate: Estate = {
    mainSha: walk.estate.mainSha,
    source: walk.estate.source,
    plans: walk.estate.blobs.map((blob, at) => ({ blob, record: records.value.records[at]! })),
    indexes: walk.estate.indexes,
    dangling: walk.estate.dangling,
  };
  const branches: BranchStageReadings = { ...walk.branches, added: new Map(Object.entries(walk.branches.added)) };
  const assembled = assemblePlanWalk(
    { estate: answered(estate), branches: answered(branches), desks: answered({ mainSha: walk.desks.mainSha, desks }) },
    { slug: '', offer: false },
  );
  if (!assembled.ok) return 'unknown';
  const { header } = walk;
  const document = fleetReading(
    assembled.value,
    {
      main: header.main,
      readRef: header.readRef,
      localHead: header.localHead,
      fetchFailed: header.fetchFailed,
      fetchError: header.fetchError,
      planDir: header.planDir,
      host: walk.branches.hostReach,
      mergeDetect: header.mergeDetect,
      nowSeconds: header.nowSeconds,
      planSource: walk.estate.source,
    },
    new Map(Object.entries(walk.conflicts)),
  );
  return { pulse: FleetReadingSchema.parse(document), records: records.value.records };
};

/**
 * The approval date of each plan the pulse lists, from the `plans` reading.
 *
 * @returns plan basename → epoch ms; a plan with no dated `Approved:` record is absent.
 */
const approvalsOf = (pulse: FleetReading, records: readonly PlanEntry[]): Map<string, number> => {
  const listed = new Set(pulse.plans.map((plan) => baseOf(plan.file)));
  const dates = new Map<string, number>();
  for (const record of records) {
    const base = baseOf(record.file);
    const at = approvalDateOf(record.approvedRaw);
    if (listed.has(base) && at !== null) dates.set(base, at);
  }
  return dates;
};

const mapOf = <T>(reading: { value: Record<string, T> } | 'unknown'): Map<string, T> | 'unknown' =>
  reading === 'unknown' ? 'unknown' : new Map(Object.entries(reading.value));

/**
 * The board's fleet view, derived from a snapshot's readings alone.
 *
 * Reads nothing and starts no process. Each field is `unknown`, or null for
 * the PR maps, where a reading it needs is `unread` or `failed`.
 *
 * @param snapshot - the snapshot fleetd sent.
 * @param now - the clock branch ages are measured from, epoch ms.
 * @returns the view.
 * @throws where the walk's readings assemble into a document that is not a pulse.
 */
export const fleetViewFrom = (snapshot: RepoSnapshot, now: number): BoardView => {
  const { readings } = snapshot;
  const walk = readings.walk;
  const walked = walk.state === 'read' ? pulseOf(walk.value, readings.plans, readings.deskFiles, readings.workers) : 'unknown';
  const at = walk.state === 'read' ? walk.readAt : null;
  const dates = readingValue(readings.branchDates);
  const aged = dates === 'unknown' ? 'unknown' : branchAgesOf(dates.value, now);
  const unmerged = readingValue(readings.unmerged);
  const rows = readingValue(readings.prs);
  const maps = rows === 'unknown' ? null : mapsOfRows(rows.value);
  return {
    pulse: walked === 'unknown' ? 'unknown' : walked.pulse,
    at,
    fetchedAt: walk.state === 'read' && !walk.value.header.fetchFailed ? walk.readAt : null,
    ages: aged === 'unknown' ? 'unknown' : aged.ages,
    tipAt: aged === 'unknown' ? 'unknown' : aged.tipAt,
    branchUrlBase: walk.state === 'read' ? branchUrlBase(walk.value.branches.origin) : 'unknown',
    approvedAt: walked === 'unknown' ? 'unknown' : approvalsOf(walked.pulse, walked.records),
    ideaPlans: mapOf(readingValue(readings.ideaPlans)),
    versions: mapOf(readingValue(readings.releaseVersions)),
    unmerged: unmerged === 'unknown' ? 'unknown' : new Set(unmerged.value.branches),
    claimOnly: unmerged === 'unknown' ? 'unknown' : new Set(unmerged.value.claimOnly),
    questions: mapOf(readingValue(readings.questions)),
    prs: maps?.prs ?? null,
    prsByNumber: maps?.byNumber ?? null,
    prsByHead: maps?.byHead ?? null,
  };
};
