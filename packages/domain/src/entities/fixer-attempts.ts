import { z } from 'zod';

/**
 * The version word a fixer attempts record carries.
 *
 * A literal, so a future format's file fails the parse rather than the
 * reader — a wrong-version record must read as UNREADABLE, never as an empty
 * one, so a budget check never spends an attempt fresh out of a format it
 * cannot read.
 */
export const FIXER_ATTEMPTS_VERSION = 1;

/**
 * What a fixer answered the attempt with, named so two attempts on the same
 * finding can be told from two on different ones.
 *
 * A HIGH review carries the findings' hash; a CI-red start carries the run id
 * it answered. Neither is derived here — the caller computes it and the
 * record only keeps what it was given.
 */
export const FixerFindingSchema = z.union([
  z.object({ kind: z.literal('high'), hash: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('ci'), runId: z.string().min(1) }).strict(),
]);
export type FixerFinding = z.infer<typeof FixerFindingSchema>;

/**
 * A fixer still running, or the last one that was.
 *
 * Written BEFORE the fixer starts, by the same caller that appends the
 * attempt — see {@link FixerAttempt}. Carries no end time: the caller that
 * ends a fixer removes this mark from the attempt it belongs to, rather than
 * stamping a completion the way `ReaderClaim.released` does, because a
 * fixer's attempt is immutable once it is spent (see the record's own
 * contract on `FixerAttemptsRecordSchema`).
 */
export const FixerInFlightSchema = z
  .object({
    pid: z.number().int().positive(),
    /** ISO-8601, this machine's clock. */
    startedAt: z.string().min(1),
  })
  .strict();
export type FixerInFlight = z.infer<typeof FixerInFlightSchema>;

/**
 * One fixer attempt on one PR.
 *
 * WRITTEN ONCE, BEFORE THE FIXER STARTS, AND NEVER MUTATED AFTER THE FIXER
 * ENDS. A fixer that ends without a push still spent this attempt — the
 * record holds no "refunded" marker, because the plan's decision is that an
 * attempt is spent by starting, not by succeeding. `inFlight` is the one
 * field a caller may still touch after the write: present while the fixer
 * runs, absent once it has ended.
 */
export const FixerAttemptSchema = z
  .object({
    /** The head SHA the fixer was started for. */
    headSha: z.string().min(1),
    /** The finding this attempt answered. */
    finding: FixerFindingSchema,
    /** Present while the fixer this attempt describes is still running. */
    inFlight: FixerInFlightSchema.optional(),
  })
  .strict();
export type FixerAttempt = z.infer<typeof FixerAttemptSchema>;

/**
 * One PR's fixer attempts, keyed by PR NUMBER rather than by head.
 *
 * **PER PR, NOT PER HEAD.** The plan's budget is two attempts across every
 * head a PR carries; a per-head key would grant a fresh budget on every push,
 * which is exactly the loophole this schema exists to close. `attempts` is
 * read as a whole regardless of which head is asking.
 */
export const FixerAttemptsRecordSchema = z
  .object({
    v: z.literal(FIXER_ATTEMPTS_VERSION),
    pr: z.number().int().positive(),
    attempts: z.array(FixerAttemptSchema),
  })
  .strict();
export type FixerAttemptsRecord = z.infer<typeof FixerAttemptsRecordSchema>;

/**
 * Parses a record file's text.
 *
 * **THREE OUTCOMES, NOT TWO — missing/empty text is `'none'`, a version
 * mismatch or any other malformed content is `'unreadable'`, and valid text
 * is the record.** The plan requires these to stay apart: a missing file
 * reads as zero attempts (the safe direction for a budget that must not grant
 * free retries), while a corrupt or wrong-version file reads as unreadable —
 * carried through rather than silently treated as zero, so a caller holding
 * the in-flight question (see {@link fixerInFlight}) never mistakes "cannot
 * read this" for "nothing is running".
 *
 * @param text - the file's contents; `''` for a file that does not exist.
 * @returns `'none'` for empty text, `'unreadable'` for text that is not a
 *   record this version recognises, or the decoded record.
 */
export const decodeFixerAttempts = (text: string): FixerAttemptsRecord | 'none' | 'unreadable' => {
  if (text.trim() === '') return 'none';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'unreadable';
  }
  const result = FixerAttemptsRecordSchema.safeParse(parsed);
  return result.success ? result.data : 'unreadable';
};

/**
 * Renders a record as the text written to disk.
 *
 * @param record - the record to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeFixerAttempts = (record: FixerAttemptsRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;
