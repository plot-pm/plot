import { z } from 'zod';

/**
 * One write Plot made to a tracker, as the issue index folds it.
 *
 * `connector` and `account` name the tracker the write reached, so the fold
 * counts the request against that connector's budget only. The other fields
 * hold what the tracker answered to the write: `number` and `status` for a
 * status write; `number`, `title` and `url` for an issue-open. A field the
 * tracker did not answer is absent.
 *
 * NO `.default()`: a default would put a value into the index that no tracker
 * said.
 */
export const IssueWriteSchema = z
  .object({
    /** The connector the write reached — `Tracker.spender().connector`. */
    connector: z.string(),
    /** The account the write was charged to; absent where the connector names none. */
    account: z.string().optional(),
    /** The tracker's identifier of the issue the write changed. */
    number: z.string(),
    /** The title, where the write carried one (an issue-open). */
    title: z.string().optional(),
    /** The tracker's address of the issue; `''` where it cannot be composed. */
    url: z.string().optional(),
    /** The status the tracker accepted, in its own vocabulary. */
    status: z.string().optional(),
    /** The status category, where the tracker stated one with the answer. */
    statusCategory: z.string().optional(),
    /** The tracker's `updatedAt` for the changed issue, ISO-8601, where it gave one. */
    updatedAt: z.string().optional(),
  })
  .strict();

export type IssueWrite = z.infer<typeof IssueWriteSchema>;

/**
 * Parses one spool line, or null where it is not a write this Plot knows.
 *
 * @param line - one line of the spool.
 * @returns the write, or null for an empty, unparseable or unrecognised line.
 */
export const decodeIssueWrite = (line: string): IssueWrite | null => {
  if (line.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const result = IssueWriteSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders one write as a spool line.
 *
 * @param write - the write.
 * @returns one line of JSON, newline-terminated.
 */
export const encodeIssueWrite = (write: IssueWrite): string => `${JSON.stringify(write)}\n`;
