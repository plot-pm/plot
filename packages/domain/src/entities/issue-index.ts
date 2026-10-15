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
 * Rows in one page of an issue read, as `plot-host.sh` names it
 * (`ISSUE_PAGE_ROWS`): Jira's `maxResults` on a paged read, and the rows `gh`
 * fetches per request inside its one process. A read of N rows spends at least
 * `ceil(N / ISSUE_PAGE_ROWS)` requests.
 */
export const ISSUE_PAGE_ROWS = 100;

/** How many open issues the index folds: the cap of the open read, above which `complete` is false. */
export const ISSUE_INDEX_OPEN_LIMIT = 1000;

/** How far back the index keeps closed issues, in days. */
export const ISSUE_INDEX_CLOSED_DAYS = 14;

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
    /** When the tracker says it was closed, ISO-8601; absent on an open issue and where it gave none. */
    closedAt: z.string().optional(),
    /** The tracker's own logins or Jira accounts assigned; absent where the row predates this field. */
    assignees: z.array(z.string()).optional(),
    /** The tracker's own word for the kind of work, as written; absent where it gave none or the row predates this field. */
    type: z.string().optional(),
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
 * The closed issues of the last {@link ISSUE_INDEX_CLOSED_DAYS} days, read on
 * their own answer.
 *
 * `answer` and `failedAt` track the closed read alone: a failed closed read
 * keeps the previous `since`, `rows`, `complete` and `at` and leaves the open
 * read's rows untouched. `at` moves only on an answered closed read, and is
 * absent where no closed read has answered.
 */
export const IssueIndexClosedSchema = z
  .object({
    /** The earliest closing time the read asked for, ISO-8601. */
    since: z.string(),
    /** When the closed read last answered, ISO-8601; absent where none has answered. */
    at: z.string().optional(),
    /** The closed read's own outcome. */
    answer: IssueIndexAnswerSchema,
    /** When the closed read last answered anything but `answered`; absent otherwise. */
    failedAt: z.string().optional(),
    /** Why the closed read did not answer `answered`; absent otherwise. */
    reason: z.string().optional(),
    /** The closed issues kept from the last answered closed read, newest close first. */
    rows: z.array(IssueIndexRowSchema).optional(),
    /** Whether `rows` holds every issue closed since `since` or stopped at the read's limit. */
    complete: z.boolean().optional(),
  })
  .strict();

export type IssueIndexClosed = z.infer<typeof IssueIndexClosedSchema>;

/**
 * What one repository's issue store holds: the open issues the issue gate last
 * read, and the gate's cadence fields the PR pass reads.
 *
 * `connector`, `account`, `requests`, `nextAt` and `backoffUntil` are the
 * input of {@link cadenceRateOf} and of the PR pass's backoff hold. They come
 * from the tracker's own spender reading for the source the pass asked.
 *
 * `account` is absent where the budget record named no account; a reader reads
 * an absent account as `null`.
 *
 * `source` is a key: a reader compares it with its own `issueSource` reading
 * and refuses the rows where they differ.
 *
 * A failed pass keeps the previous `rows`, `complete` and `at`, and writes
 * `failedAt` and `reason`. `rows` and `complete` are absent where no pass has
 * answered yet.
 *
 * `closed` is optional: a file written before the closed read existed decodes
 * with it absent, which a reader takes as "not read".
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
    /** The closed issues of the last 14 days, under their own answer; absent where never read. */
    closed: IssueIndexClosedSchema.optional(),
    /**
     * The reader's own open tickets, read as their own query — absent where no
     * inbox read happened (no `Ticket prefixes` declared, or a tracker other
     * than Jira), never an empty array for "the inbox has nothing in it".
     */
    inbox: z.array(IssueIndexRowSchema).optional(),
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
