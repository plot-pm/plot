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
