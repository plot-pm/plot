import { z } from 'zod';

/**
 * The version word a store file carries.
 *
 * **A LITERAL, SO AN UNRECOGNISED VALUE FAILS THE PARSE RATHER THAN THE
 * READER.** A reader comparing the string itself would have to remember to
 * compare it; a schema that only accepts this one makes a future format's file
 * unparseable by construction, which is the fallback the store is required to
 * take — the same contract `PR_INDEX_VERSION` keeps.
 */
export const ISSUE_INDEX_VERSION = 1;

/**
 * One open issue as the store holds it — exactly what the tracker answered,
 * and nothing the board inferred.
 *
 * **NO `.default()` ANYWHERE.** A default is how a cold store stops being
 * byte-identical to no store: the file round-trips a field the tracker never
 * answered, and a reader treats an invented value as a measurement.
 */
export const IssueIndexRowSchema = z
  .object({
    /** The tracker's own identifier, as a string — see `Issue.id`. */
    number: z.string(),
    title: z.string(),
    /** The tracker's address, verbatim; `''` where the tracker gave none. */
    url: z.string(),
    /** When the tracker says it was created, ISO-8601; absent where it gave none. */
    createdAt: z.string().optional(),
    /** The tracker's own word for the stage; absent where it gave none. */
    status: z.string().optional(),
    /** The stable three-value vocabulary; absent where the tracker's word has no mapping. */
    statusCategory: z.string().optional(),
  })
  .strict();

export type IssueIndexRow = z.infer<typeof IssueIndexRowSchema>;

/** Who answered the pass that wrote this file — `issueSource`'s own word. */
export const IssueIndexSourceSchema = z.union([z.literal('tracker'), z.literal('git-host')]);

/** What the last pass's open read came back as — the same three outcomes every port answers in. */
export const IssueIndexAnswerSchema = z.union([
  z.literal('answered'),
  z.literal('unsupported'),
  z.literal('failed'),
]);

/**
 * What one repository's issue store holds — the open issues the gate last
 * read, and the cadence bookkeeping the PR pass reads back.
 *
 * **THE GATE'S OWN READING, FOR THE PR PASS TO SUBTRACT AGAINST.**
 * `connector`, `account`, `requests` and `nextAt` are {@link cadenceRateOf}'s
 * input, carried on the file rather than recomputed, because the PR pass and
 * the issue pass are two processes on the same cadence and neither owns the
 * other's state. `backoffUntil` is the same carry for the backoff hold:
 * present and in the future where the tracker named a wait, `null` otherwise.
 *
 * **`account` IS OPTIONAL AND NEVER DEFAULTED TO `null` BY A READER.** A
 * connector with no notion of account — `trackerGitHost` sharing the git
 * host's own budget — never writes the key, and {@link cadenceRateOf} already
 * treats an absent gate account and a `null` PR account as matching only when
 * both sides agree, so the distinction between "no account" and "account not
 * yet known" survives the round trip.
 *
 * **`source` IS A KEY, NOT A VERDICT.** A reader compares it against its own
 * `issueSource` reading and refuses the rows on a mismatch; nothing reads it
 * to decide a lane, a lifecycle step or a spend.
 *
 * **A FAILED PASS KEEPS THE PREVIOUS `rows` AND `at`.** `answer: 'failed'`
 * carries `failedAt` and `reason`; `at` moves only on an answered read, the
 * same rule `askedAt` follows elsewhere. `rows` and `complete` are absent on
 * an `unsupported`/`failed` first pass — there is nothing kept yet.
 */
export const IssueIndexSchema = z
  .object({
    /** The format version; an unrecognised one fails the parse. */
    v: z.literal(ISSUE_INDEX_VERSION),
    /** Who answered — the `issueSource` reading the pass read. */
    source: IssueIndexSourceSchema,
    /** Which connector answered — `github`, `jira`. */
    connector: z.string(),
    /** The account the connector's budget is keyed by, where it has one. */
    account: z.string().optional(),
    /** How many requests the pass that wrote this file spent. */
    requests: z.number(),
    /** Epoch ms the next pass is due. */
    nextAt: z.number(),
    /** Epoch ms the tracker's named backoff ends, or `null` where there is none. */
    backoffUntil: z.number().nullable(),
    /** When this machine wrote the file, ISO-8601 — moves only on an answered read. */
    at: z.string(),
    /** The last pass's own outcome. */
    answer: IssueIndexAnswerSchema,
    /** When the last pass answered anything but `answered`; absent otherwise. */
    failedAt: z.string().optional(),
    /** Why the last pass did not answer `answered`; absent otherwise. */
    reason: z.string().optional(),
    /** The open issues kept from the last answered read. */
    rows: z.array(IssueIndexRowSchema).optional(),
    /** Whether `rows` holds every open issue or stopped at the read's own limit. */
    complete: z.boolean().optional(),
  })
  .strict();

export type IssueIndex = z.infer<typeof IssueIndexSchema>;

/**
 * Parses a store file's text, or null where it is not one this Plot knows.
 *
 * **EVERY FAILURE IS `null`, AND THAT IS THE CONTRACT.** Unparseable JSON, an
 * unrecognised `v`, a row whose shape changed, an empty file — each means one
 * full read, exactly the behaviour of a cold store. The store is an
 * optimisation; its absence may cost a tracker call and nothing else.
 *
 * @param text - the file's contents.
 * @returns the parsed store, or null where it cannot be read as one.
 */
export const decodeIssueIndex = (text: string): IssueIndex | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = IssueIndexSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a store as the text written to disk.
 *
 * Pretty-printed with two spaces: the file is read by operators diagnosing a
 * gate that asked too much or too little.
 *
 * @param index - the store to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeIssueIndex = (index: IssueIndex): string =>
  `${JSON.stringify(index, null, 2)}\n`;
