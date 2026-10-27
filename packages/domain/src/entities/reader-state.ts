import { z } from 'zod';

/**
 * The version word a reader state file carries.
 *
 * A literal, so an unrecognised value fails the parse rather than the reader.
 */
export const READER_STATE_VERSION = 1;

/**
 * What the elected reader last learned about one repository's PR refresh —
 * separate from the lock's owner-claim files, which stay minimal (pid,
 * startedAt, at) so the atomic-publish discipline they need stays cheap.
 *
 * A follower reads this to render an honest board without asking the host
 * itself: `prError`, `prNextAt` and `prNextIsBackoff` are the reader's own
 * cadence and last failure, and `prFullReadFailedAt` is whether its last full
 * read landed.
 */
export const ReaderStateSchema = z
  .object({
    /** The format version; an unrecognised one fails the parse. */
    v: z.literal(READER_STATE_VERSION),
    /** The reader's last failure or partial-answer sentence, or null. */
    prError: z.string().nullable(),
    /** Epoch ms the reader's next refresh is due. */
    prNextAt: z.number(),
    /** Whether `prNextAt` is a floor the host named, rather than the ordinary cadence. */
    prNextIsBackoff: z.boolean(),
    /** Epoch ms the reader's last full read failed, or null where its last full read landed. */
    prFullReadFailedAt: z.number().nullable(),
    /** When this machine wrote the file, epoch milliseconds. */
    at: z.number(),
  })
  .strict();

export type ReaderState = z.infer<typeof ReaderStateSchema>;

/**
 * Parses a reader state file's text, or null where it is not one this Plot
 * knows.
 *
 * Every failure is `null`: unparseable JSON, an unrecognised `v`, a shape that
 * changed, an empty file. The file is an optimisation for a follower; its
 * absence or unreadability costs an honest "no reading yet", never a throw.
 *
 * @param text - the file's contents.
 * @returns the parsed state, or null where it cannot be read as one.
 */
export const decodeReaderState = (text: string): ReaderState | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = ReaderStateSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a reader state as the text written to disk.
 *
 * @param state - the state to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeReaderState = (state: ReaderState): string => `${JSON.stringify(state, null, 2)}\n`;
