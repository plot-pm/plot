import { z } from 'zod';

/** How far a host list call reached, as the branch rule reads it. */
// plot-state: reading — the host list call of one walk; the next walk asks again.
const HostReachSchema = z.enum(['ok', 'unasked', 'throttled', 'secondary', 'failed']);

/** What the host said about one PR, as the branch rule reads it. */
// plot-state: reading — the host's answer for one branch at one walk; the next walk asks again.
const PrReadingSchema = z.enum(['OPEN', 'MERGED', 'CLOSED', 'none', 'unreadable']);

/** Whether a commit is contained in the default branch. */
// plot-state: reading — one ancestry answer at one walk; the next walk asks again.
const ContainmentSchema = z.enum(['yes', 'no', 'unknown']);

/** Why the `--loose` PR row is absent: no host, no cached row, or no PR. */
// plot-state: reading — what one walk's listing held; the next walk reads it again.
const PrAbsenceSchema = z.enum(['no-host', 'no-cache', 'none']);

/** The PR state word of a `--loose` PR row. */
// plot-state: reading — the host's word at one listing; the next listing replaces it.
const PrRowStateSchema = z.enum(['OPEN', 'MERGED', 'CLOSED']);

/** Where the estate read its plans: the default branch's ref, or the checkout. */
// plot-state: classification — names a source; a walk reads either, whatever the last one read.
const PlanSourceSchema = z.enum(['ref', 'worktree']);

/** Which index directory a symlink sits in. */
// plot-state: classification — names a directory; a link sits in one or the other.
const IndexDirSchema = z.enum(['active', 'delivered']);

/** Who wrote a `PLOT-BLOCKED` marker. */
// plot-state: classification — names a writer; either writes any marker.
const MarkerAuthorSchema = z.enum(['loop', 'fleetd']);

/** One branch line's readings, as `readBranchReadings` gathers them. */
const WalkBranchSchema = z.object({
  plan: z.string(),
  branch: z.string(),
  readings: z.object({
    deferredByPlan: z.boolean(),
    refTip: z.string().nullable(),
    mainTip: z.string().nullable(),
    mergeSubjectFound: z.boolean(),
    hostReach: HostReachSchema,
    pr: PrReadingSchema,
    prListComplete: z.boolean(),
    commitsAhead: z.number(),
    realCommitsAhead: z.number(),
    waits: z.array(z.object({ branch: z.string(), pr: PrReadingSchema, namedSlice: z.boolean() })).readonly(),
  }),
  landed: z.array(z.object({ commit: z.string(), contained: ContainmentSchema })).readonly(),
  changedPaths: z.array(z.string()).readonly(),
  localAhead: z.number().optional(),
  subjectPredatesPlan: z.boolean().optional(),
  prDetail: z
    .union([
      PrAbsenceSchema,
      z.object({ state: PrRowStateSchema, checks: z.string(), draft: z.boolean() }),
    ])
    .optional(),
});

/** One desk's git readings beside its desk files and worker: what `readDeskReadings` adds. */
const WalkDeskSchema = z.object({
  branch: z.string(),
  worktree: z.string(),
  locked: z.boolean(),
  unpushed: z.union([z.array(z.string()).readonly(), z.literal('unknown')]),
  quietSeconds: z.number().nullable(),
  dirty: z.union([z.array(z.string()).readonly(), z.literal('unknown')]),
});

/**
 * The plan walk's gathered readings that the other keys do not hold: the
 * checkout header, the estate's blobs and index links, the branch stage, the
 * desks' git readings and the conflicts. The plan records come from `plans`,
 * and each desk's files and worker from `deskFiles` and `workers`.
 */
export const WalkValueSchema = z.object({
  header: z.object({
    /** The default branch's name. */
    main: z.string(),
    /** The short commit of `origin/<main>`, or `unknown`. */
    readRef: z.string(),
    /** The short commit of the checkout's `HEAD`, or `unknown`. */
    localHead: z.string(),
    fetchFailed: z.boolean(),
    fetchError: z.string(),
    planDir: z.string(),
    mergeDetect: z.string(),
    /** The walk's clock, in epoch seconds. */
    nowSeconds: z.number(),
  }),
  estate: z.object({
    mainSha: z.string(),
    source: PlanSourceSchema,
    /** One blob per record of the `plans` reading, in the same order. */
    blobs: z.array(z.object({ sha: z.string(), path: z.string(), source: z.string() })).readonly(),
    indexes: z.array(z.object({ index: IndexDirSchema, path: z.string(), target: z.string() })).readonly(),
    dangling: z.array(z.string()).readonly(),
  }),
  branches: z.object({
    mainSha: z.string(),
    backend: z.string(),
    origin: z.string(),
    hostReach: HostReachSchema,
    merges: z.array(z.object({ sha: z.string(), subject: z.string() })).readonly(),
    /** Plan file → the commit that first added it. */
    added: z.record(z.string(), z.string()),
    branches: z.array(WalkBranchSchema).readonly(),
    listing: z
      .object({
        rows: z.array(z.object({ key: z.string(), state: z.string(), checks: z.string(), draft: z.string() })).readonly(),
        complete: z.boolean(),
        tracked: z.number(),
      })
      .optional(),
  }),
  desks: z.object({ mainSha: z.string(), desks: z.array(WalkDeskSchema).readonly() }),
  /** Branch → its conflicting paths, for each branch whose conflicts were read. */
  conflicts: z.record(z.string(), z.array(z.string()).readonly()),
});
export type WalkValue = z.infer<typeof WalkValueSchema>;

/** Each remote branch's tip commit time, in epoch seconds, as `Refs.branchDates` answers. */
export const BranchDatesValueSchema = z.array(z.object({ branch: z.string(), committedAt: z.number() })).readonly();
export type BranchDatesValue = z.infer<typeof BranchDatesValueSchema>;

/** Branch → a string: the plan file of an idea branch, or the version a release branch ships. */
export const BranchTextValueSchema = z.record(z.string(), z.string());

/** The remote branches with commits the default branch lacks, and those whose only commits are claim markers. */
export const UnmergedValueSchema = z.object({
  branches: z.array(z.string()).readonly(),
  claimOnly: z.array(z.string()).readonly(),
});
export type UnmergedValue = z.infer<typeof UnmergedValueSchema>;

/** Branch → what its desk's `PLOT-BLOCKED` marker asks, when it was written, and any escalation recorded for it. */
export const QuestionsValueSchema = z.record(
  z.string(),
  z.object({
    firstLine: z.string(),
    askedAt: z.string(),
    author: MarkerAuthorSchema.optional(),
    escalation: z.string().optional(),
  }),
);
export type QuestionsValue = z.infer<typeof QuestionsValueSchema>;
