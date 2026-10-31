import { z } from 'zod';

/**
 * The version word the repair record file carries.
 *
 * A literal, so a future format's file fails the parse rather than the reader.
 */
export const REPAIR_RECORD_VERSION = 1;

/**
 * Where one red episode's repair sits in its life.
 *
 * `idle`        the episode is open; no re-run has been asked yet.
 * `rerun`       the first red SHA's failed jobs were re-run once, awaiting the answer.
 * `repairing`   the one repair attempt is in flight: a fix PR open or in review.
 * `reverting`   the bound passed; a revert is in flight.
 * `done`        main settled green; any open fix or revert PR was closed.
 * `exhausted`   the episode ends with nothing more to try — a revert already
 *               made, an unexplained red, a conflicting revert, or an
 *               undeclared `Merger app`.
 */
// plot-state: lifecycle repair-record — idle -> rerun -> repairing -> reverting
//                                       -> done | exhausted. transitions/repair-record.ts
//                                       holds the legal moves; done and exhausted
//                                       are terminal.
export const RepairStateSchema = z.enum(['idle', 'rerun', 'repairing', 'reverting', 'done', 'exhausted']);
export type RepairState = z.infer<typeof RepairStateSchema>;

/** One commit between the last green SHA and the first red SHA, as the picker reads it. */
export const CandidateCommitSchema = z
  .object({
    sha: z.string(),
    subject: z.string(),
  })
  .strict();
export type CandidateCommit = z.infer<typeof CandidateCommitSchema>;

/**
 * What the record holds about the one repair attempt this episode made.
 *
 * Absent while the episode is `idle` or `rerun`: an attempt exists only once
 * `start-repair` has fired.
 */
export const RepairAttemptSchema = z
  .object({
    /** The branch `redMainStep`'s caller claimed and dispatched the role to. */
    branch: z.string(),
    /**
     * How the attempt ended on this machine: `lost` where another machine won
     * the claim, `ended` where the role run ended. Absent while the attempt is
     * open. Either value ends the attempt for the episode.
     */
    // plot-state: reading — what ended this machine's attempt, written once by
    //                       `repairAttemptStep`'s caller; read on every pass.
    outcome: z.enum(['lost', 'ended']).optional(),
    /** True once a run that crashed with no ending record was resumed; a run resumes at most once. */
    resumed: z.literal(true).optional(),
  })
  .strict();
export type RepairAttempt = z.infer<typeof RepairAttemptSchema>;

/**
 * The facts one red episode of the default branch needs to be repaired.
 *
 * Separate from `default-branch.json`: that file's schema is `.strict()` and a
 * parse failure reads as no reading, so an added field or version bump there
 * would make every older reader lift the hold on a red main. This file is new
 * and carries no such reader.
 *
 * Two writers. Fleetd opens the record at the change from green to red, and
 * keeps an open record of the same episode rather than replacing it. A person
 * sets `repairPr` through `plot-ask.mjs repair-pr <pr>`, which re-reads the
 * record before its write and refuses where it changed. The record is local
 * to the machine that wrote it — it guards one machine's repair, not a
 * cross-machine lock.
 */
export const RepairRecordSchema = z
  .object({
    v: z.literal(REPAIR_RECORD_VERSION),
    /** The default branch this episode is about. */
    branch: z.string(),
    /** The lifecycle state. */
    state: RepairStateSchema,
    /**
     * The last commit `default-branch.json` held settled green before this
     * episode, or absent where the refresh had no previous reading to carry
     * one from.
     */
    lastGreenSha: z.string().optional(),
    /** The first commit this episode settled red. */
    firstRedSha: z.string(),
    /**
     * When fleetd first observed the settled red, ISO-8601, this machine's
     * clock — not a CI completion time.
     */
    redSince: z.string(),
    /**
     * The first-parent commits strictly between `lastGreenSha` and
     * `firstRedSha`, newest first. Fixed at the episode's start; never
     * re-read as the settled SHA moves.
     */
    candidates: z.array(CandidateCommitSchema),
    /**
     * Whether the first red SHA's failed jobs have been re-run yet.
     *
     * A green answer here ends the episode with no agent; a red answer moves
     * the record out of `idle`/`rerun` toward `repairing`.
     */
    // plot-state: reading — whether the episode's one re-run of the first red
    //                       SHA has been asked for. Set once, at `start-repair`;
    //                       `redMainStep` re-reads it every pass until it settles.
    rerun: z.enum(['none', 'asked']),
    /**
     * Whether the last green SHA has been re-run, which `revert` requires
     * before it fires.
     *
     * A red answer here means the failure sits outside the repository, so the
     * episode goes to `exhausted` rather than reverting.
     */
    // plot-state: reading — whether the pre-revert re-run of the last green
    //                       SHA has been asked for. Set once, when the repair
    //                       bound is reached; re-read until it settles.
    preRevertRerun: z.enum(['none', 'asked']),
    /** The one repair attempt this episode made, or absent where none has. */
    attempt: RepairAttemptSchema.optional(),
    /**
     * The fix PR's number, or absent where none is recorded. Set by fleetd,
     * or by a person through `plot-ask.mjs repair-pr <pr>`.
     */
    repairPr: z.number().optional(),
    /** The revert PR's number, or absent where none was opened. */
    revertPr: z.number().optional(),
    /** The PR the revert reverts, recorded when the revert is picked; absent before. */
    revertedPr: z.number().optional(),
    /** The reverted PR's head branch, as the host listed it; absent where it was not read. */
    revertedBranch: z.string().optional(),
    /**
     * The plan file whose slices name `revertedBranch`, `''` where no plan
     * names it, or absent where the plans were not read.
     */
    revertedPlan: z.string().optional(),
    /**
     * This machine's claim of the revert branch: `won` before the desk is
     * made, so a later pass makes it without a second claim; `lost` where
     * another machine holds the branch, which ends this machine's revert for
     * the episode. Absent before the claim.
     */
    // plot-state: reading — the outcome of this machine's one claim push for the
    //                       revert branch, written once; read on every pass.
    revertClaim: z.enum(['won', 'lost']).optional(),
    /** When fleetd wrote the file, ISO-8601. */
    at: z.string(),
  })
  .strict();
export type RepairRecord = z.infer<typeof RepairRecordSchema>;

/**
 * Parses the file's text, or null where it is not one this Plot knows.
 *
 * Every failure is null — unparseable JSON, another `v`, an empty file — and
 * null holds no open episode.
 *
 * @param text - the file's contents.
 * @returns the record, or null where the text cannot be read as one.
 */
export const decodeRepairRecord = (text: string): RepairRecord | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = RepairRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a record as the text written to disk.
 *
 * @param record - the record to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeRepairRecord = (record: RepairRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;
