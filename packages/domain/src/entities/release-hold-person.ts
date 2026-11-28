import { z } from 'zod';

/** The version word the person hold file carries. Another version reads as no record. */
export const RELEASE_HOLD_PERSON_VERSION = 1;

/**
 * A person's last act on the release hold: a hold or a lift, for one release PR head.
 *
 * The file holds the act only. Whether merges are held is derived on every pass
 * by `releasePersonHold` from this record, the release PR's index row and the clock.
 */
export const ReleaseHoldPersonRecordSchema = z
  .object({
    v: z.literal(RELEASE_HOLD_PERSON_VERSION),
    /** The release PR's number. */
    pr: z.number().int().positive(),
    /** `hold` starts a hold; `lift` ends the hold on `head`. */
    // plot-state: classification — a person may hold after a lift and lift after a hold; each act replaces the last whole.
    act: z.enum(['hold', 'lift']),
    /** The release PR head commit the act names. */
    head: z.string().min(1),
    /** When the act was recorded, ISO-8601, this machine's clock. */
    at: z.string(),
    /** Who recorded the act. */
    by: z.string(),
  })
  .strict();
export type ReleaseHoldPersonRecord = z.infer<typeof ReleaseHoldPersonRecordSchema>;

/**
 * Parses the file's text.
 *
 * @param text - the file's contents.
 * @returns the record, or `null` for empty text, unparseable JSON, another `v` or another shape.
 */
export const decodeReleaseHoldPerson = (text: string): ReleaseHoldPersonRecord | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = ReleaseHoldPersonRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a record as the text written to disk.
 *
 * @param record - the record to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeReleaseHoldPerson = (record: ReleaseHoldPersonRecord): string => `${JSON.stringify(record, null, 2)}\n`;

/** Why a person hold holds nothing now, as the board's payload carries it. */
// plot-state: reading — the reason at one board build; `releaseHoldView` re-reads it on every build.
export const ReleaseHoldNoneSchema = z.enum([
  'no-record',
  'lifted',
  'no-release-row',
  'not-open',
  'not-into-default-branch',
  'unparseable-at',
  'bound-passed',
  'stage-ended',
]);

/** Whether the release PR is holdable, or `no-row` where no open release PR into the default branch exists. */
// plot-state: reading — the release row's word at one board build; `releaseHoldView` re-reads it on every build.
export const ReleaseHoldableWordSchema = z.enum([
  'no-row',
  'holdable',
  'not-open',
  'not-release-branch',
  'not-into-default-branch',
  'no-head',
  'checks-not-counted',
  'review-failed',
  'review-writer-unchecked',
  'release-head-foreign',
]);

/** The person hold as the board reads it: the hold, whether a new hold may start, and the PRs it holds. */
export const ReleaseHoldViewSchema = z.object({
  /** The hold, from `releasePersonHold`. */
  hold: z.discriminatedUnion('holds', [
    z.object({ holds: z.literal(true), pr: z.number(), head: z.string(), since: z.number(), end: z.number() }),
    z.object({ holds: z.literal(false), reason: ReleaseHoldNoneSchema }),
  ]),
  /** `releaseHoldable` over the release row, or `no-row`. */
  holdable: ReleaseHoldableWordSchema,
  /** The release row's number, or `null` where there is no row. */
  pr: z.number().nullable(),
  /** The release row's head, or `null` where it has none. */
  head: z.string().nullable(),
  /** The open PRs into the default branch the hold holds now, the release PR excluded; `[]` where nothing holds. */
  held: z.array(z.number()),
});
export type ReleaseHoldView = z.infer<typeof ReleaseHoldViewSchema>;
