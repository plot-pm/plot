import { z } from 'zod';

import { DefaultBranchReadingSchema } from './default-branch.js';
import { WorkerActivitySchema, WorkerStateSchema } from './fleet.js';
import { IssueIndexRowSchema } from './issue-index.js';
import { PrIndexRowSchema } from './pr-index.js';
import {
  BranchDatesValueSchema,
  BranchTextValueSchema,
  QuestionsValueSchema,
  UnmergedValueSchema,
  WalkValueSchema,
} from './view-readings.js';

/**
 * The reading keys of a {@link RepoSnapshot}, one per source the snapshot holds.
 */
export const READING_KEYS = [
  'refs',
  'desks',
  'deskFiles',
  'workers',
  'plans',
  'registry',
  'prs',
  'issues',
  'defaultBranch',
  'config',
  'walk',
  'branchDates',
  'ideaPlans',
  'releaseVersions',
  'unmerged',
  'questions',
] as const;

// plot-state: classification — names a source, not a state; no key moves into
//                              another, and every snapshot holds all of them.
export const ReadingKeySchema = z.enum(READING_KEYS);
export type ReadingKey = z.infer<typeof ReadingKeySchema>;

/** One ref and the object it points at; the same fields as the `Refs` port's `RefState`. */
export const RefEntrySchema = z.object({
  ref: z.string(),
  sha: z.string(),
  head: z.literal(true).optional(),
});
export type RefEntry = z.infer<typeof RefEntrySchema>;

/**
 * Every ref with its object, in `for-each-ref` order, and the digest that
 * differs whenever any ref moved: the data fields of the walk cache's
 * `RefSnapshot`. `snapshotOf(entries)` in `workflows/plan-walk-cache.ts`
 * rebuilds its lookup.
 */
export const RefsValueSchema = z.object({
  entries: z.array(RefEntrySchema).readonly(),
  digest: z.string(),
});
export type RefsValue = z.infer<typeof RefsValueSchema>;

/** One worktree as the `Trees` port lists it, with the commit its `HEAD` names where that was read. */
export const DeskEntrySchema = z.object({
  path: z.string(),
  branch: z.string(),
  detached: z.boolean(),
  isMain: z.boolean(),
  clean: z.boolean(),
  agentSession: z.string().nullable(),
  prunable: z.boolean(),
  /** The commit the desk's `HEAD` names; absent where it was not read. */
  head: z.string().optional(),
});
export type DeskEntry = z.infer<typeof DeskEntrySchema>;

/** What one desk's own files hold, as the `Agents` port's `desk` answers, keyed by the desk's absolute path. */
export const DeskFilesValueSchema = z.record(
  z.string(),
  z.object({
    question: z.string(),
    markers: z.array(z.string()).readonly(),
    pid: z.string(),
    exit: z.string().nullable(),
  }),
);
export type DeskFiles = z.infer<typeof DeskFilesValueSchema>;

/** One desk's worker record and liveness, as the `Processes` port's `workerState` answers. */
export const WorkerReadingSchema = z.object({
  state: WorkerStateSchema,
  pid: z.string(),
  exitCode: z.string(),
  activity: WorkerActivitySchema,
});
export type WorkerReading = z.infer<typeof WorkerReadingSchema>;

const PlanBranchSchema = z.object({
  branch: z.string(),
  deferred: z.boolean(),
  deferredReason: z.string(),
  claimed: z.string(),
  waitsOn: z.array(z.string()).readonly(),
  spike: z.boolean().optional(),
  commits: z.array(z.string()).readonly().optional(),
});

/** One plan, sprint or story file as the `PlanStore` port's `PlanRecord` reports it. */
export const PlanEntrySchema = z.object({
  file: z.string(),
  format: z.string(),
  phase: z.string(),
  phaseRaw: z.string(),
  type: z.string(),
  title: z.string(),
  sprint: z.string(),
  story: z.string(),
  assignee: z.string(),
  branches: z.array(z.string()).readonly(),
  prs: z.array(z.number()).readonly(),
  deferredPrs: z.array(z.number()).readonly(),
  slices: z.array(z.object({ name: z.string(), branches: z.array(PlanBranchSchema).readonly() })).readonly(),
  tracer: z.boolean().optional(),
  review: z.string(),
  impl: z.string(),
  approvedRaw: z.string(),
  spikeApprovedRaw: z.string(),
  deliveredRaw: z.string(),
  releasedRaw: z.string(),
  startedRaw: z.array(z.string()).readonly(),
  rejectedRaw: z.string(),
  unreadBranchItems: z.array(z.object({ wave: z.string(), branch: z.string(), line: z.string() })).readonly(),
});
export type PlanEntry = z.infer<typeof PlanEntrySchema>;

/** The plan files read at one ref. */
export const PlansValueSchema = z.object({
  /** The ref the files were read at, such as `origin/main`. */
  ref: z.string(),
  records: z.array(PlanEntrySchema).readonly(),
});
export type PlansValue = z.infer<typeof PlansValueSchema>;

/** One agent manifest from the registry directory, as the `Agents` port's `AgentManifest` reports it. */
export const RegistryEntrySchema = z.object({
  session: z.string(),
  resumeId: z.string(),
  branch: z.string(),
  slug: z.string(),
  worktree: z.string(),
  command: z.string(),
  startedAt: z.string(),
  pid: z.string(),
  previousPid: z.string(),
  relaunches: z.number(),
  attempts: z.number(),
});
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

/**
 * Builds the schema of one reading: `read` with its value, `unread`, or
 * `failed` with a reason.
 *
 * @param value - the schema of the value a `read` reading holds.
 * @returns the reading schema. `readAt` is epoch milliseconds: when the held
 *   content was read.
 */
export const readingSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('state', [
    z.object({ state: z.literal('read'), readAt: z.number(), value }),
    z.object({ state: z.literal('unread') }),
    z.object({ state: z.literal('failed'), readAt: z.number(), reason: z.string().min(1) }),
  ]);

/** A reading of any value: `read` holds the value, `unread` and `failed` hold none. */
export type SnapshotReading<T> =
  | { state: 'read'; readAt: number; value: T }
  | { state: 'unread' }
  | { state: 'failed'; readAt: number; reason: string };

/**
 * One repository's readings: every answer the fleet and the board derive their
 * verdicts from, and no verdict.
 *
 * `generation` grows by one whenever a reading's content changes.
 */
export const RepoSnapshotSchema = z.object({
  generation: z.number().int().nonnegative(),
  readings: z.object({
    refs: readingSchema(RefsValueSchema),
    desks: readingSchema(z.array(DeskEntrySchema).readonly()),
    deskFiles: readingSchema(DeskFilesValueSchema),
    workers: readingSchema(z.record(z.string(), WorkerReadingSchema)),
    plans: readingSchema(PlansValueSchema),
    registry: readingSchema(z.array(RegistryEntrySchema).readonly()),
    prs: readingSchema(z.array(PrIndexRowSchema).readonly()),
    issues: readingSchema(z.array(IssueIndexRowSchema).readonly()),
    defaultBranch: readingSchema(DefaultBranchReadingSchema),
    config: readingSchema(z.record(z.string(), z.string())),
    walk: readingSchema(WalkValueSchema),
    branchDates: readingSchema(BranchDatesValueSchema),
    ideaPlans: readingSchema(BranchTextValueSchema),
    releaseVersions: readingSchema(BranchTextValueSchema),
    unmerged: readingSchema(UnmergedValueSchema),
    questions: readingSchema(QuestionsValueSchema),
  }),
});
export type RepoSnapshot = z.infer<typeof RepoSnapshotSchema>;
export type Readings = RepoSnapshot['readings'];

/**
 * The snapshot before any read: every key `unread`, generation 0.
 *
 * @returns a new snapshot.
 */
export const emptySnapshot = (): RepoSnapshot => ({
  generation: 0,
  readings: Object.fromEntries(READING_KEYS.map((key) => [key, { state: 'unread' }])) as Readings,
});

/**
 * The value a reading holds.
 *
 * @param reading - any reading of the snapshot.
 * @returns `{ value }` for a `read` reading, including an empty one, and
 *   `unknown` for an `unread` or `failed` one.
 */
export const readingValue = <T>(reading: SnapshotReading<T>): { value: T } | 'unknown' =>
  reading.state === 'read' ? { value: reading.value } : 'unknown';
