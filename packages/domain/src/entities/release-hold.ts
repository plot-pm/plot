import { z } from 'zod';

/** The version word the release hold file carries. Another version reads as no record. */
export const RELEASE_HOLD_VERSION = 1;

/**
 * When fleetd first held merges for one release head, and whether a person lifted that hold.
 *
 * The file holds facts only. Whether merges are held is derived on every pass by
 * `releaseHold` from this record and the release PR's index row.
 */
export const ReleaseHoldRecordSchema = z
  .object({
    v: z.literal(RELEASE_HOLD_VERSION),
    /** The release PR head commit the record is about. */
    head: z.string(),
    /** When fleetd first held merges for `head`, ISO-8601, this machine's clock. */
    since: z.string(),
    /** Who lifted the hold for `head`; absent where nobody did. */
    liftedBy: z.string().optional(),
  })
  .strict();
export type ReleaseHoldRecord = z.infer<typeof ReleaseHoldRecordSchema>;

/**
 * Parses the file's text.
 *
 * @param text - the file's contents.
 * @returns the record, or `null` for empty text, unparseable JSON, another `v` or another shape.
 */
export const decodeReleaseHold = (text: string): ReleaseHoldRecord | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = ReleaseHoldRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a record as the text written to disk.
 *
 * @param record - the record to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeReleaseHold = (record: ReleaseHoldRecord): string => `${JSON.stringify(record, null, 2)}\n`;
