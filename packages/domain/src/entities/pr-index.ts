import { z } from 'zod';

/**
 * The version word a store file carries.
 *
 * **A LITERAL, SO AN UNRECOGNISED VALUE FAILS THE PARSE RATHER THAN THE
 * READER.** A reader comparing the string itself would have to remember to
 * compare it; a schema that only accepts this one makes a future format's file
 * unparseable by construction, which is the fallback the store is required to
 * take.
 */
export const PR_INDEX_VERSION = 6;

/**
 * One PR as the store holds it — exactly what the host answered, and nothing
 * the board inferred.
 *
 * **EVERY OPTIONAL FIELD IS OPTIONAL HERE BECAUSE IT IS ABSENT THERE.** The
 * host adapter omits `mergeable` on an older `gh`, omits `failing_checks` on
 * Bitbucket, and omits `url` on both when the CLI predates it. `refreshPrs`
 * normalizes each to a DIFFERENT absent value — `""`, `"unknown"`, `[]` — and
 * the store round-trips whichever it was handed rather than inventing a fourth.
 * Writing `false` or `"none"` for a field the host never answered manufactures
 * the verdict `an-unasked-host-is-not-an-absent-pr` exists to remove.
 *
 * **NO `.default()` ANYWHERE.** A default is how a cold store stops being
 * byte-identical to no store: the file round-trips a field the host never
 * answered, and the board reads an invented value as a measurement.
 */
export const PrIndexRowSchema = z
  .object({
    /** The PR's number — the store's key, and the only field it is keyed by. */
    number: z.number(),
    /** The head branch; a PR whose head the host omitted carries `''`. */
    head: z.string(),
    /** OPEN · MERGED · CLOSED · unknown, exactly as the adapter normalized it. */
    state: z.string(),
    draft: z.boolean(),
    /** green · pending · failing · none · unknown. */
    checks: z.string(),
    review: z.string(),
    url: z.string(),
    /** Absent where the adapter did not answer it; never defaulted to a word. */
    mergeable: z.string().optional(),
    /** Absent where the adapter did not answer it; never defaulted to `[]`. */
    failing_checks: z.array(z.string()).optional(),
    /**
     * The author's handle as the host spelled it. Absent where the host did not
     * answer; never stored as `''`.
     */
    author: z.string().optional(),
    /**
     * When the host last saw this PR change, ISO-8601 as the host spelled it.
     *
     * **THE HOST'S CLOCK, NEVER THIS MACHINE'S**, and optional because an
     * adapter that does not answer it leaves the store unable to advance rather
     * than advancing it wrongly. A row with no `updatedAt` contributes nothing
     * to the watermark.
     */
    updatedAt: z.string().optional(),
    /**
     * The commit the PR's head pointed at when the host answered. Absent where
     * the host did not answer; never stored as `''`.
     */
    headSha: z.string().optional(),
    /**
     * When the fold first saw this `headSha`, ISO-8601.
     *
     * **THIS MACHINE'S CLOCK, UNLIKE `updatedAt`.** Carried forward unchanged
     * while `headSha` is unchanged and reset when it moves. Absent on a row with
     * no `headSha`.
     */
    headSince: z.string().optional(),
    /**
     * The commit `checks` was computed for. Present only where the adapter binds
     * the checks to a commit (the GitHub rollup); absent for Jenkins, the plain
     * listing and Bitbucket.
     */
    checksSha: z.string().optional(),
    /** When the host merged the PR, as the host spelled it; absent on a PR it has not merged. */
    mergedAt: z.string().optional(),
    /**
     * `'skipped'` where the cap (`SHA_LOOKUPS_PER_PASS`) left this row out —
     * never named for a sha lookup this pass. `'broken'` where the row WAS
     * named and the lookup then broke early (Jenkins unreachable mid-pass) —
     * a different fact: the colour may belong to a commit this PR no longer
     * carries, same as `'skipped'`, but for a different reason, so the two
     * are not collapsed. Neither is where Jenkins itself answered. Absent
     * everywhere else, including every non-Jenkins adapter; never a value
     * that collides with `checks`.
     */
    // plot-state: reading — what one pass's Jenkins lookup did with this row,
    //                       not an order either value passes through. Re-read
    //                       fresh every pass; a row named 'broken' this pass
    //                       may be 'skipped' or absent the next.
    checksLookup: z.enum(['skipped', 'broken']).optional(),
    /**
     * The `plot/review` status context's state, read from the GitHub rollup.
     *
     * **`'absent'` MEANS ASKED AND NOT FOUND — A DIFFERENT FACT FROM MISSING.**
     * A missing field means this row's adapter never requested a rollup
     * (Jenkins, Bitbucket, the plain listing) — "I don't know." `'absent'`
     * means the rollup WAS read in full and carried no `plot/review` context —
     * "confirmed no review." Collapsing the two reintroduces the ambiguity
     * ("no review" and "review success" both reading `green` on `checks`) this
     * field exists to remove. Never written on a failed or partial rollup read.
     */
    // plot-state: reading — the status context's state as the rollup answered
    //                       it this pass, not an order a review passes through.
    //                       Re-read fresh every pass; bound to plotReviewSha.
    plotReview: z.enum(['success', 'failure', 'pending', 'error', 'absent']).optional(),
    /**
     * The commit the rollup named for the `plot/review` status context.
     * Present only alongside a `plotReview` other than `'absent'`; absent
     * everywhere `plotReview` itself is absent.
     */
    plotReviewSha: z.string().optional(),
    /**
     * The `plot/review` status context's `startedAt`, ISO-8601 as the host
     * spelled it. Present only alongside a `plotReview` other than `'absent'`;
     * absent everywhere `plotReview` itself is absent.
     */
    plotReviewAt: z.string().optional(),
    /**
     * The GitHub rollup folded the same way `checks` is, but with the
     * `plot/review` context excluded — green · pending · failing · none ·
     * unknown. Bound to `checksSha`, the same commit `checks` is bound to.
     * Absent everywhere the adapter did not request a rollup (Jenkins,
     * Bitbucket, the plain listing); never defaulted to a word.
     */
    // plot-state: reading — the rollup's colour excluding plot/review, as this
    //                       pass answered it, not an order a PR passes through.
    //                       Re-read fresh every pass; bound to checksSha.
    ciChecks: z.enum(['green', 'pending', 'failing', 'none', 'unknown']).optional(),
  })
  .strict();

export type PrIndexRow = z.infer<typeof PrIndexRowSchema>;

/**
 * What one connector's store file holds.
 *
 * **`complete` IS RECORDED, NEVER INFERRED.** `plot-fleet-scan.sh:1031` falls
 * through to one host call per branch when a bundled list cannot be proven
 * whole — measured 2026-08-23, 28 of 29 such calls were for branches with no
 * ref and no PR, re-learning `NONE` forever at ~3600 calls/hour. A store that
 * let a reader infer wholeness from "the file exists" would license the answer
 * *asked, and there is no PR* from a partial read. So a partial answer marks the
 * store `complete: false` and the flag survives until a whole answer clears it.
 *
 * **`complete` ANSWERS ONE QUESTION, AND `wholeAt` ANSWERS THE OTHER.**
 * `complete` says *the store holds every PR up to its watermark*, which a
 * healthy delta leaves true. `wholeAt` says *when this machine last replaced
 * the store from a full read*, which only a full read advances. The kind of
 * answer a refresh received is `PrIndexUpdate.kind`'s and is not stored: it
 * describes the call, not the file.
 */
export const PrIndexSchema = z
  .object({
    /** The format version; an unrecognised one fails the parse. */
    v: z.literal(PR_INDEX_VERSION),
    /** Which connector answered — `github`, `bitbucket`. */
    connector: z.string(),
    /**
     * The newest `updatedAt` any stored row carries, or `null`.
     *
     * **THE HOST'S OWN VALUE, NEVER `Date.now()`.** A client clock two seconds
     * ahead of the host excludes a PR updated in that gap from every later
     * `updated:>` window — forever, silently, because the window never reopens.
     */
    watermark: z.string().nullable(),
    /** Whether the store holds every PR the host has up to its watermark. */
    complete: z.boolean(),
    /** When this machine wrote the file, ISO-8601 — for an operator, not a window. */
    at: z.string(),
    /**
     * When this machine last folded a `whole` answer, ISO-8601.
     *
     * **THE FULL READ'S CLOCK, AND `at` CANNOT BE IT.** Every delta rewrites
     * `at`, so once a delta keeps the store whole a healthy board's `at` never
     * ages past the full-read interval and the daily full read — the only
     * answer that sees a DELETED PR — would never run again.
     *
     * **THIS MACHINE'S CLOCK, NEVER THE WATERMARK.** The watermark is the
     * host's and answers *how far have we asked*; on a repository whose newest
     * PR is a month old it is a month old too, and reading it as the store's
     * age would make that board do a full read every single refresh.
     *
     * Optional, so *no full read has been recorded* stays expressible: a store
     * with no `wholeAt` reads as due rather than as freshly replaced.
     */
    wholeAt: z.string().optional(),
    /** The rows, keyed by PR number. */
    rows: z.array(PrIndexRowSchema),
  })
  .strict();

export type PrIndex = z.infer<typeof PrIndexSchema>;

/**
 * Parses a store file's text, or null where it is not one this Plot knows.
 *
 * **EVERY FAILURE IS `null`, AND THAT IS THE CONTRACT.** Unparseable JSON, an
 * unrecognised `v`, a row whose shape changed, an empty file — each means one
 * full read, which is exactly today's behaviour. The store is an optimisation;
 * its absence may cost time and nothing else.
 *
 * @param text - the file's contents.
 * @returns the parsed store, or null where it cannot be read as one.
 */
export const decodePrIndex = (text: string): PrIndex | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = PrIndexSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a store as the text written to disk.
 *
 * Pretty-printed with two spaces: the file is read by operators diagnosing a
 * board that asked too much or too little, and a 933-row single line is one
 * nobody can diff.
 *
 * @param index - the store to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodePrIndex = (index: PrIndex): string =>
  `${JSON.stringify(index, null, 2)}\n`;
