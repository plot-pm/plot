import type { Issue } from '../../entities/issue.js';
import { ISSUE_PAGE_ROWS } from '../../entities/issue-index.js';
import type { TrackerSpender } from '../../ports/tracker.js';
import { LimitBasisSchema, type LimitBasis, type LimitReading } from '../../entities/limit.js';
import type { ClosedIssues, IssueOpenOutcome, IssueRead } from '../../ports/tracker.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import { asJson, asJsonLines, resultOf, runProcess, type ScriptRun } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { ISSUE_MAY_EXIST } from '../../rules/refuted-issues.js';

/** One issue as `plot-host.sh` reports it, before it is read as the entity. */
interface RawIssue {
  number?: number | string;
  title?: string;
  url?: string;
  createdAt?: string;
  body?: string;
  status?: string;
  statusCategory?: string;
  closedAt?: string;
  assignees?: string[];
  nextPageToken?: string;
}

/** One limit reading as `plot-host.sh` reports it. */
interface RawLimit {
  connector?: string;
  bucket?: string;
  limit?: number | null;
  remaining?: number | null;
  reset?: number | null;
  basis?: string;
}

/** Milliseconds in a second — the scripts report `reset` in epoch SECONDS. */
const MS_PER_SECOND = 1000;

/**
 * Reads one tracker issue as the domain's entity.
 *
 * The identifier stays a string. One tracker yields a number and another a
 * key, and comparing them as numbers is what makes a filter silently
 * always-false.
 *
 * `status` and `statusCategory` degrade to `''` rather than to a guess: an
 * op that reports no status (`issue-view`) and a tracker whose vocabulary has
 * no category for a state both mean *nothing was said*, and a default of
 * `To Do` would state a stage the tracker never claimed.
 *
 * @param raw - the script's JSON object.
 * @returns the issue; a null `body` means it was not fetched.
 */
export const issueOf = (raw: RawIssue): Issue => ({
  id: raw.number === undefined ? '' : String(raw.number),
  title: raw.title ?? '',
  url: raw.url ?? '',
  createdAt: raw.createdAt !== undefined && raw.createdAt !== '' ? raw.createdAt : null,
  body: raw.body ?? null,
  status: raw.status ?? '',
  statusCategory: raw.statusCategory ?? '',
  closedAt: raw.closedAt !== undefined && raw.closedAt !== '' ? raw.closedAt : null,
  assignees: raw.assignees ?? [],
});

/**
 * Splits one `issue-list` page into its issues and the next page's token.
 *
 * The script prints the token as a last JSON line, `{"nextPageToken":"…"}`,
 * which has no `number`. Every other line is an issue.
 *
 * @param stdout - the script's output for one page.
 * @returns the page's issues, and the token of the next page, or null on the last.
 */
export const pageOf = (stdout: string): { issues: Issue[]; next: string | null } => {
  const lines = asJsonLines<RawIssue>(stdout);
  const token = lines.find((line) => line.nextPageToken !== undefined)?.nextPageToken;
  return {
    issues: lines.filter((line) => line.nextPageToken === undefined).map(issueOf),
    next: token === undefined || token === '' ? null : token,
  };
};

/** The prefix `plot-host.sh` puts on every line it writes to stderr. */
const SCRIPT_PREFIX = /^plot-host: /;

/**
 * Reads the reason an exit-4 run stated on stderr.
 *
 * @param stderr - the script's stderr.
 * @returns the trimmed text without the `plot-host: ` prefix, or undefined when it is empty.
 */
export const unaskableReasonOf = (stderr: string): string | undefined =>
  stderr.trim().replace(SCRIPT_PREFIX, '') || undefined;

/** The may-exist prefix, which `rules/refuted-issues.ts` defines and reads. */
export { ISSUE_MAY_EXIST };

/**
 * Reads an `issue-open` run into the port's answer, and records its refusal.
 *
 * @param said - the finished `plot-host.sh issue-open` run.
 * @param idOf - reads the new issue's identifier from the run's stdout; null where it holds none.
 * @param refuse - records the refusal the port's `lastRefusal` reports.
 * @returns `opened` with the identifier; `unaskable` with the stated reason on
 *   exit 4; `failed` otherwise, with the refusal recorded.
 */
export const issueOpenOf = (
  said: ScriptRun,
  idOf: (stdout: string) => string | null,
  refuse: (said: string | null) => void,
): PortResult<IssueOpenOutcome> => {
  if (said.code === 4) {
    refuse(null);
    return unaskable(unaskableReasonOf(said.stderr));
  }
  if (said.interrupted !== undefined) {
    refuse(`${ISSUE_MAY_EXIST}plot-host.sh issue-open ended by ${said.interrupted} after the request may have been sent`);
    return failed();
  }
  if (said.code !== 0) {
    refuse(said.stderr.trim() || said.stdout.trim() || `plot-host.sh exited ${said.code}`);
    return failed();
  }
  const id = idOf(said.stdout);
  if (id === null) {
    refuse(`${ISSUE_MAY_EXIST}the tracker answered with no issue identifier: ${said.stdout.trim() || '(nothing)'}`);
    return failed();
  }
  refuse(null);
  return answered<IssueOpenOutcome>({ outcome: 'opened', id });
};

/**
 * Milliseconds since the epoch of an issue's `closedAt`, or -Infinity when it
 * is absent or does not parse, so such an issue sorts last.
 */
const closedMs = (issue: Issue): number => {
  const ms = issue.closedAt === null ? Number.NaN : Date.parse(issue.closedAt);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
};

/**
 * Orders closed issues newest close first.
 *
 * @param issues - the issues, in any order.
 * @returns a new array; issues with no readable `closedAt` come last, in their input order.
 */
export const newestCloseFirst = (issues: readonly Issue[]): Issue[] =>
  [...issues].sort((a, b) => closedMs(b) - closedMs(a) || 0);

/**
 * Reads a number the script may have reported as null, absent or nonsense.
 *
 * Absent is not zero: a `remaining` of 0 means the bucket is spent, while an
 * absent one means the connector did not say.
 */
const numberOr = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Reads one limit line as the domain's entity.
 *
 * An unrecognised basis degrades to `unknown`, and a reading whose basis is
 * `unknown` carries a null limit whatever the script said — a number tagged
 * *unknown* is the collapse the basis exists to refuse.
 *
 * @param raw - the script's JSON object.
 * @returns the reading, with `resetAt` in epoch MILLISECONDS.
 */
export const limitOf = (raw: RawLimit): LimitReading => {
  const parsed = LimitBasisSchema.safeParse(raw.basis);
  const basis: LimitBasis = parsed.success ? parsed.data : 'unknown';
  const reset = numberOr(raw.reset);
  return {
    connector: raw.connector ?? '',
    bucket: raw.bucket ?? '',
    limit: basis === 'unknown' ? null : numberOr(raw.limit),
    remaining: numberOr(raw.remaining),
    resetAt: reset === null ? null : reset * MS_PER_SECOND,
    basis,
  };
};

/**
 * What both connectors need in order to reach their own service.
 *
 * The scheme is passed to the script rather than read by it, which is what
 * makes each connector drive ONE arm. A script left to resolve the scheme
 * itself would let a GitHub connector answer with Jira issues the moment
 * somebody edited a config key — the branch this port exists to remove.
 */
export interface TrackerShell {
  /** Where the scripts and the repository are. */
  context: ShellContext;
  /** The scheme this connector drives, as `plot-host.sh` names it. */
  scheme: string;
  /** The tracker's address; `''` where it needs none. */
  baseUrl: string;
  /** The connector's own name, as its limit readings are tagged. */
  connector: string;
}

/**
 * The reading half both connectors share, holding no vendor decision.
 *
 * SHARED CODE IS NOT A SHARED BUDGET. Each connector calls this with its own
 * scheme and its own environment, so the two never see each other's tokens,
 * windows or refusals — what is shared here is the shape of a JSON line, which
 * is the script's contract rather than any vendor's.
 *
 * @param shell - the connector's context, scheme and address.
 * @param env - the environment the connector's credentials live in.
 * @returns the read operations, and the refusal the last one left behind.
 */
export const trackerReads = (shell: TrackerShell, env: Readonly<Record<string, string>>) => {
  const host = scriptPath(shell.context, 'plot-host.sh');
  const run = { cwd: shell.context.repoRoot, env };

  /**
   * Why the last call did not answer — the port's `lastRefusal`.
   *
   * Exit 4 is NOT a refusal. It says this connector cannot be asked at all,
   * which is a standing configuration fact rather than an incident worth
   * waiting out.
   */
  let refusal: string | null = null;

  /**
   * Maps one run into a result and keeps its refusal. Exit 4 answers
   * `unaskable` carrying the reason the script stated on stderr.
   */
  const record = <T>(script: ScriptRun, parse: (stdout: string) => T): PortResult<T> => {
    refusal =
      script.code === 0 || script.code === 4
        ? null
        : script.stderr.trim() || script.stdout.trim() || `plot-host.sh exited ${script.code}`;
    return script.code === 4 ? unaskable(unaskableReasonOf(script.stderr)) : resultOf(script, parse);
  };

  const ask = async <T>(args: readonly string[], parse: (stdout: string) => T) =>
    record(await runProcess('bash', [host, ...args], run), parse);

  /**
   * Reads `issue-list` page by page.
   *
   * One script call reads one page and holds no loop: the script prints the
   * next page's token as a last line, and this passes it back as
   * `--page-token`. A script that prints none (GitHub pages inside its one
   * process) is read once. The read stops at `limit` rows and reports
   * `complete: false` there; it also stops, incomplete, when a page makes no
   * progress, so a tracker repeating its token cannot loop it.
   *
   * `pages` is the larger of the script calls made and
   * `ceil(rows / ISSUE_PAGE_ROWS)`, because one `gh` call spends one request
   * per page inside its process.
   *
   * Exit 4 answers `unaskable` carrying the script's stated reason. Any page
   * that fails fails the whole read, because rows from the pages before it
   * would pass for the end of the list.
   *
   * @param head - the `issue-list` arguments every page repeats.
   * @param limit - how many issues to read at most.
   * @returns the issues in the script's order, whether the read reached its
   *   end, and the requests it spent.
   */
  const walk = async (head: readonly string[], limit: number): Promise<PortResult<IssueRead>> => {
    const issues: Issue[] = [];
    let token: string | null = null;
    const seen = new Set<string>();
    let calls = 0;
    while (issues.length < limit) {
      const args = [...head, '--limit', String(limit - issues.length)];
      if (token !== null) args.push('--page-token', token);
      const page = record(await runProcess('bash', [host, ...args], run), (stdout) => pageOf(stdout));
      calls += 1;
      if (!page.ok) return page;
      issues.push(...page.value.issues);
      token = page.value.next;
      if (token === null || page.value.issues.length === 0 || seen.has(token)) break;
      seen.add(token);
    }
    const kept = issues.slice(0, limit);
    return answered({
      issues: kept,
      complete: token === null && issues.length < limit,
      pages: Math.max(1, calls, Math.ceil(kept.length / ISSUE_PAGE_ROWS)),
    });
  };

  return {
    issueList: (limit?: number): Promise<PortResult<readonly Issue[]>> =>
      ask(['issue-list', ...(limit === undefined ? [] : ['--limit', String(limit)])], (stdout) =>
        pageOf(stdout).issues,
      ),

    /**
     * Lists the open issues, walking the script's pages: `issue-list --paged`.
     * See {@link walk}.
     *
     * @param limit - how many issues to read at most.
     * @returns the open issues in the script's order, whether the read reached
     *   its end, and the requests it spent.
     */
    issueListOpen: (limit: number): Promise<PortResult<IssueRead>> =>
      walk(['issue-list', '--paged'], limit),

    /**
     * Lists the issues closed at or after `since`, walking the script's pages,
     * and sorts them by `closedAt` after the last page, because no tracker
     * search promises that order: GitHub ignores a close-date sort. See
     * {@link walk}.
     *
     * @param since - the earliest closing time to include, ISO-8601.
     * @param limit - how many issues to read at most.
     * @returns the closed issues, newest first, whether the read reached its
     *   end, and the requests it spent.
     */
    issueListClosed: async (since: string, limit: number): Promise<PortResult<ClosedIssues>> => {
      const read = await walk(['issue-list', '--state', 'closed', '--since', since], limit);
      return read.ok ? answered({ ...read.value, issues: newestCloseFirst(read.value.issues) }) : read;
    },

    issueView: (id: string): Promise<PortResult<Issue>> =>
      ask(['issue-view', id], (stdout) => issueOf(asJson<RawIssue>(stdout))),

    limit: async (): Promise<PortResult<readonly LimitReading[]>> => {
      const readings = await ask(['limit'], (stdout) => asJsonLines<RawLimit>(stdout).map(limitOf));
      if (!readings.ok) return readings;
      // ONLY THIS CONNECTOR'S BUCKETS. `plot-host.sh limit` reports whatever the
      // repository's git host meters, and a tracker reached through the same
      // script must not hand a caller the git host's headroom as its own. A
      // connector that meters nothing answers an empty list, which is an answer.
      return answered(readings.value.filter((reading) => reading.connector === shell.connector));
    },

    lastRefusal: (): string | null => refusal,

    /**
     * Names this connector and the account its budget lines are keyed by.
     *
     * Reads `plot-host.sh spend-rate --connector <connector>`, which reads the
     * budget record and asks no service. Leaves the last refusal unchanged,
     * because it reads no tracker. A run that fails or prints no account
     * answers a null account.
     *
     * @returns the connector and account, always answered.
     */
    spender: async (): Promise<PortResult<TrackerSpender>> => {
      const said = resultOf(
        await runProcess('bash', [host, 'spend-rate', '--connector', shell.connector], run),
        (stdout) => asJson<{ account?: unknown }>(stdout).account,
      );
      const account = said.ok && typeof said.value === 'string' && said.value !== '' ? said.value : null;
      return answered({ connector: shell.connector, account });
    },

    /** Lets a write record its own refusal on the same reading. */
    refuse: (said: string | null): void => {
      refusal = said;
    },
  };
};
