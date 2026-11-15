/** The states of Jira issue read in-process: the four `plot-host.sh issue-list` answers over Jira's search. */
export type JiraReadState = 'open' | 'closed' | 'inbox' | 'changed';

/** The fields every Jira issue read asks. */
const BASE_FIELDS = 'summary,created,status,assignee,issuetype,fixVersions';

/** The most rows one page of Jira's search carries; `ISSUE_PAGE_ROWS` in `plot-host.sh`. */
export const JIRA_PAGE_ROWS = 100;

/** The shape `--since` takes: a date, or a date with an hour and minute. */
const SINCE_SHAPE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}[0-9:.]*Z?)?$/;

/** The minutes a changed read adds to cover clock skew. */
const SKEW_MINUTES = 5;

/**
 * The project keys `Ticket prefixes` names.
 *
 * A declared duplicate of `tracker_projects` in `plot-host.sh`, held to it by
 * `corpus/jira-issue-reads.corpus.test.ts`: the value splits on commas, each
 * key is trimmed, and empty keys are dropped. A value that is punctuation
 * alone names no project.
 *
 * @param declared - the value `PLOT_TICKET_PREFIXES` or the `Ticket prefixes` config key holds.
 * @returns the keys in declared order.
 */
export const jiraProjects = (declared: string): string[] =>
  declared
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '');

/**
 * What a Jira read asks, or why it asks nothing.
 *
 * `unscoped` is a closed or changed read with no project declared: an unscoped
 * `resolved >=` or `updated >=` query reads every project on the instance.
 * `since` is a `since` outside the shape the query splices.
 */
export type JiraQuery =
  | {
      readonly ok: true;
      /** The JQL string. */
      readonly jql: string;
      /** The comma-separated `fields` parameter. */
      readonly fields: string;
    }
  | { readonly ok: false; readonly refusal: 'unscoped' | 'since' };

/** What {@link jiraQuery} reads. */
export interface JiraQueryInput {
  /** Which read. */
  readonly state: JiraReadState;
  /** The earliest time of a closed or changed read, ISO-8601; ignored by the others. */
  readonly since?: string;
  /** The project keys, from {@link jiraProjects}. */
  readonly projects: readonly string[];
  /** The value of `PLOT_JIRA_JQL`, or `''` where unset. */
  readonly override: string;
  /** The clock, epoch milliseconds; read by the changed read only. */
  readonly nowMs: number;
}

/**
 * The minutes from `since` to now, plus five, and at least five.
 *
 * A changed read sends a relative `-Nm` time, because Jira reads an absolute
 * JQL time in the reader's profile zone while a relative time names one
 * instant in every zone. A `since` with no time of day reads as midnight, and
 * one cut short at its minutes reads as the minute with zero seconds.
 *
 * @param since - the ISO-8601 time; the date part and the first eight characters of the time part count.
 * @param nowMs - the clock, epoch milliseconds.
 * @returns the whole minutes, rounded up.
 */
export const jiraRelativeMinutes = (since: string, nowMs: number): number => {
  const time = since.slice(11, 19);
  const padded = time + '00:00:00'.slice(time.length);
  const thenMs = Date.parse(`${since.slice(0, 10)}T${padded}Z`);
  const minutes = Math.ceil((nowMs - thenMs) / 60_000) + SKEW_MINUTES;
  return minutes < SKEW_MINUTES ? SKEW_MINUTES : minutes;
};

/**
 * Builds the query one Jira issue read sends.
 *
 * A declared duplicate of the `issue-list` Jira arm of `plot-host.sh`, held to
 * it by `corpus/jira-issue-reads.corpus.test.ts`. The project scope splices
 * `AND project IN (…)` before `ORDER BY`. The person clause `assignee =
 * currentUser() AND` drops once a scope exists, and the inbox keeps it
 * always. `PLOT_JIRA_JQL` replaces the open and inbox queries and no other. A
 * closed or changed read with no project refuses before any request.
 *
 * @param input - the read, the projects, the override and the clock.
 * @returns the JQL and the fields, or the reason the read asks nothing.
 */
export const jiraQuery = (input: JiraQueryInput): JiraQuery => {
  const { state, projects, override } = input;
  const scope = projects.length === 0 ? '' : ` AND project IN (${projects.join(', ')})`;
  if (state === 'closed' || state === 'changed') {
    const since = input.since ?? '';
    if (!SINCE_SHAPE.test(since)) return { ok: false, refusal: 'since' };
    if (scope === '') return { ok: false, refusal: 'unscoped' };
    if (state === 'closed') {
      const when = `${since.slice(0, 10)} ${since.slice(11, 16)}`.replace(/ $/, '');
      return { ok: true, jql: `resolved >= "${when}"${scope} ORDER BY resolved DESC`, fields: `${BASE_FIELDS},resolutiondate` };
    }
    const minutes = jiraRelativeMinutes(since, input.nowMs);
    return {
      ok: true,
      jql: `updated >= "-${minutes}m"${scope} ORDER BY updated DESC`,
      fields: `${BASE_FIELDS},updated,resolutiondate`,
    };
  }
  if (state === 'inbox') {
    return {
      ok: true,
      jql: override !== '' ? override : `assignee = currentUser() AND resolution = EMPTY${scope} ORDER BY created DESC`,
      fields: BASE_FIELDS,
    };
  }
  const person = scope === '' ? 'assignee = currentUser() AND ' : '';
  return {
    ok: true,
    jql: override !== '' ? override : `${person}resolution = EMPTY${scope} ORDER BY created DESC`,
    fields: BASE_FIELDS,
  };
};

/**
 * How many rows one page asks: the rows still wanted, at most one page.
 *
 * @param wanted - how many rows the read still wants.
 * @returns `maxResults` for the page.
 */
export const jiraPageSize = (wanted: number): number => (wanted <= JIRA_PAGE_ROWS ? wanted : JIRA_PAGE_ROWS);
