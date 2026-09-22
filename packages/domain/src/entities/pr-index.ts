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
export const PR_INDEX_VERSION = 1;

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
     * When the host last saw this PR change, ISO-8601 as the host spelled it.
     *
     * **THE HOST'S CLOCK, NEVER THIS MACHINE'S**, and optional because an
     * adapter that does not answer it leaves the store unable to advance rather
     * than advancing it wrongly. A row with no `updatedAt` contributes nothing
     * to the watermark.
     */
    updatedAt: z.string().optional(),
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
    /** Whether the answer this store was last written from covered every state. */
    complete: z.boolean(),
    /** When this machine wrote the file, ISO-8601 — for an operator, not a window. */
    at: z.string(),
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
