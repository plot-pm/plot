import { z } from 'zod';

/**
 * The version word the release-finish record file carries.
 *
 * A literal, so a future format's file fails the parse rather than the reader.
 */
export const RELEASE_FINISH_RECORD_VERSION = 1;

/** The tag spelling a release-finish record is keyed by: `vN.N.N`. */
const TAG = /^v\d+\.\d+\.\d+$/;

/**
 * Whether a version is the `vN.N.N` tag spelling, and so safe as a file name.
 *
 * @param version - the version as the caller holds it.
 * @returns `true` for `vN.N.N`; `false` for every other text, including `N.N.N`, `''` and a path.
 */
export const validVersion = (version: string): boolean => TAG.test(version);

/**
 * How one release finish ended.
 *
 * `booked` the finish pushed a booking; `refused` it refused by name;
 * `already-released` the version owed nothing.
 */
// plot-state: reading — the outcome of one finish at one instant, written by the
//                       finish's entry and replaced whole by the next finish of
//                       the same version; the unbooked row reads it.
export const ReleaseFinishOutcomeSchema = z.enum(['booked', 'refused', 'already-released']);
export type ReleaseFinishOutcome = z.infer<typeof ReleaseFinishOutcomeSchema>;

/**
 * What one release finish left: its outcome, its refusal reason, and what it booked.
 *
 * `version` is the tag spelling `vN.N.N`. `at` is an ISO-8601 instant. `caller`
 * is the caller the finish ran as. `reason` is the refusal's reason, or `''`
 * where the finish did not refuse. `booked` holds the booked plan slugs and
 * `notes` the finish's notes. `sprintClosed` is the closed sprint's slug, or `null`.
 */
export const ReleaseFinishRecordSchema = z
  .object({
    v: z.literal(RELEASE_FINISH_RECORD_VERSION),
    version: z.string().regex(TAG),
    at: z.string(),
    caller: z.enum(['person', 'unattended', 'fleetd']),
    outcome: ReleaseFinishOutcomeSchema,
    reason: z.string(),
    booked: z.array(z.string()).readonly(),
    notes: z.array(z.string()).readonly(),
    sprintClosed: z.string().nullable(),
  })
  .strict();
export type ReleaseFinishRecord = z.infer<typeof ReleaseFinishRecordSchema>;

/**
 * Parses the record file's text.
 *
 * @param text - the file's text.
 * @returns the record, or `null` for empty or unparseable text, another `v`, or another shape.
 */
export const decodeReleaseFinishRecord = (text: string): ReleaseFinishRecord | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = ReleaseFinishRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a record as the text written to disk.
 *
 * @param record - the record to render.
 * @returns pretty-printed JSON with a trailing newline.
 */
export const encodeReleaseFinishRecord = (record: ReleaseFinishRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;

/** The part of the last finish record the unbooked row shows. */
export interface LastFinish {
  readonly at: string;
  readonly outcome: ReleaseFinishOutcome;
  readonly reason: string;
}

/**
 * The last finish the unbooked row shows, from the record read.
 *
 * @param record - the record, or `null` where none reads.
 * @returns `{ at, outcome, reason }`, or `null` where there is no record.
 */
export const lastFinishOf = (record: ReleaseFinishRecord | null): LastFinish | null =>
  record === null ? null : { at: record.at, outcome: record.outcome, reason: record.reason };
