import { refusalKind, type RefusalKind } from './refusal.js';

/**
 * Whether a refusal names missing credentials rather than a limit or an
 * outage. `RefusalKind` stays closed over `quota`/`secondary`/`outage` — the
 * issue footer reads it too — so this is read from the message text directly,
 * the same way `refusalKind` itself is.
 *
 * `gh`'s own wording for a signed-out CLI: `gh: authentication required`. Read
 * off the wording for the reason `refusalKind`'s own doc gives: the exit code
 * is the same 1 a spent quota or a 503 exits with.
 *
 * @param message - the host CLI's stderr, or null where nothing failed.
 * @returns true where the message names missing credentials.
 */
const missingCredentials = (message: string | null): boolean =>
  message !== null && /authentication required/i.test(message);

/**
 * The three severities the PR footer may show — a display axis, not a failure
 * kind. {@link RefusalKind} names WHICH limit refused; this names how urgent
 * that refusal reads to someone looking at the board.
 *
 * `info`     the data is fresh, or there is no refusal to report.
 * `warning`  data is on screen, and it is stale or the host refused the last
 *            read (a limit, an outage, or a page it cannot prove complete).
 * `error`    no PR data has landed yet.
 */
export type PrStatusLevel = 'info' | 'warning' | 'error';

/**
 * One `plot-host` notice extracted from a combined error string.
 *
 * A notice is one of the informational lines written to stderr with the
 * `plot-host: ` prefix: `<backend> ignores --limit`, `<backend> pr-list
 * state=<s> page complete`, `pr-list sweep complete`, and the `… read from
 * <source>` credential-source lines — the JENKINS_USER/JENKINS_API_TOKEN and
 * JIRA_EMAIL/JIRA_API_TOKEN pairs from `skills/plot/scripts/plot-host.sh`, and
 * the BITBUCKET_REVIEW_USER/BITBUCKET_REVIEW_APP_PASSWORD pair from
 * `skills/plot/scripts/plot-bitbucket-commit-status.mjs`. Each reports
 * something true about the read and never a failure. A failure carries the
 * same `plot-host: ` prefix, so the prefix alone does not make a line a
 * notice.
 */
export interface HostNotice {
  /** The notice text, with the `plot-host: ` prefix removed. */
  text: string;
}

/**
 * The informational lines `plot-host.sh` prints, each matched in full so the
 * match ends where the notice ends. Any text after a notice, prefixed or not,
 * stays in the remainder.
 */
const NOTICE_PATTERNS = [
  /\S+ ignores --limit \d+; the listing returns one page of \d+ per state/,
  /\S+ pr-list state=\S+ page complete \([^)\n]*\) — this page holds every pull request the host has in this state/,
  /pr-list sweep complete \([^)\n]*\) — every tracked branch was asked and each answered/,
  /\S+ pr-list state=\S+ window complete \([^)\n]*\) — this window holds every pull request the host has in this state since the stamp/,
  // `read from the environment`, `read from .env`, or `read from the main
  // checkout's .env` — the three source labels `plot-host.sh`'s
  // `plot_env_file` and `plot-bitbucket-commit-status.mjs`'s
  // `envFileCandidate` print. Matched to the end of the sentence rather than
  // `\S+`, which stopped after "the" and left "environment" in the remainder
  // as a false outage cause.
  /(?:JENKINS_USER and JENKINS_API_TOKEN|JIRA_EMAIL and JIRA_API_TOKEN|BITBUCKET_REVIEW_USER and BITBUCKET_REVIEW_APP_PASSWORD) read from (?:the environment|\.env|the main checkout's \.env)/,
] as const;

const NOTICE = new RegExp(
  `plot-host:[ \\t]*(${NOTICE_PATTERNS.map((pattern) => `(?:${pattern.source})`).join('|')})`,
  'g',
);

/**
 * Splits `plot-host`'s informational notices out of a combined error string.
 *
 * A segment is a notice only where its text matches one of the informational
 * lines `plot-host.sh` prints. A `plot-host: ` line with any other text — a
 * `die`, a throttle, a partial answer — is a failure and stays in the
 * remainder, as does every unprefixed line.
 *
 * @param message - the host CLI's stderr, or null where nothing failed.
 * @returns the notices found (empty where none), and the message with every
 *   notice removed, blank lines dropped and each remaining line trimmed; null
 *   where nothing remains.
 */
export const extractHostNotices = (
  message: string | null,
): { notices: HostNotice[]; remainder: string | null } => {
  if (!message) return { notices: [], remainder: null };
  const notices: HostNotice[] = [...message.matchAll(NOTICE)].map((match) => ({
    text: match[1].trim(),
  }));
  const remainder = message
    .replace(NOTICE, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return { notices, remainder: remainder.length > 0 ? remainder : null };
};

/** What the board already has, read for one PR-status decision. */
export interface PrStatusInput {
  /** The host CLI's stderr, or null where the last read succeeded. */
  error: string | null;
  /** Seconds since the data on screen was read, or null where none has ever landed. */
  ageSeconds: number | null;
  /** Seconds until the backoff this refusal set ends, or null where none is known. */
  nextInSeconds: number | null;
  /** How many spenders the budget record accounts for, or null where it cannot say. */
  spenders: number | null;
  /**
   * The ordinary refresh interval, in seconds: the age limit's unit where no
   * read is scheduled, and the grace past a scheduled read where it is longer
   * than {@link PR_OVERDUE_GRACE_SECONDS}.
   */
  intervalSeconds: number;
  /**
   * Seconds the next scheduled read is past due, 0 while it is still ahead.
   * Null or absent where no schedule is known, or where the schedule is a
   * host backoff: the age is then measured against the interval.
   */
  overdueSeconds?: number | null;
}

/**
 * The beat a PR reader asks its cadence gate on, in milliseconds: fleetd's
 * clock, the standalone PR reader and a board each run one PR pass per beat.
 * A read that falls due between two beats starts on the next beat.
 */
export const PR_READ_BEAT_MS = 60_000;

/**
 * What one PR pass may take on a loaded fleetd, from its beat to the
 * published reader state, in milliseconds. fleetd's log on 2026-10-31 read
 * `cost=29345ms..33897ms` per tick.
 */
export const PR_PASS_COST_MS = 35_000;

/**
 * How far past its schedule a healthy read can land as a board sees it, in
 * seconds: one beat until the reader's gate opens, one pass, and one beat
 * until a following board re-reads the reader state. 155 s.
 */
export const PR_OVERDUE_GRACE_SECONDS = (2 * PR_READ_BEAT_MS + PR_PASS_COST_MS) / 1000;

/**
 * Why a reading with no refusal counts as stale.
 *
 * `overdue`  the next scheduled read is past due by more than the grace:
 *            {@link PR_OVERDUE_GRACE_SECONDS}, or the interval where that is
 *            longer.
 * `aged`     no schedule is known, and the data is older than twice the
 *            interval.
 */
export type PrStaleness = 'overdue' | 'aged';

/**
 * The decision the PR footer renders — level, cause, backoff end and notices,
 * with no wording chosen. `host-notes.ts`'s `prStatusEntry` reads this and composes
 * the sentence; this says only what is true.
 */
export interface PrStatus {
  /** How urgently the footer should present this reading. */
  level: PrStatusLevel;
  /** Which limit refused, or null where nothing did. */
  kind: RefusalKind | null;
  /**
   * The failure text with `plot-host`'s own notices removed, or null where
   * there was no refusal or the whole message was notices.
   */
  cause: string | null;
  /** Seconds until the backoff ends, or null where none applies or none is known. */
  backoffInSeconds: number | null;
  /** How many spenders the record accounts for, or null where it cannot say. */
  spenders: number | null;
  /** `plot-host`'s own notices, kept separate from `cause` for a diagnostics view. */
  notices: HostNotice[];
  /**
   * Why the data counts as stale, or null where it does not: a refusal, no
   * data, or a read still on schedule.
   */
  stale: PrStaleness | null;
}

/**
 * Decides the PR footer's level, cause and backoff end from what the board
 * already reads — no rendering, no new detector.
 *
 * The notices are removed first, and the kind is classified from what
 * remains. A message made only of notices therefore has no kind, no cause and
 * no effect on the level.
 *
 * The level follows the data. With no data landed (`ageSeconds === null`) it
 * is `error`, whatever the refusal, and so it is where the refusal names
 * missing credentials, whether or not data is on screen. With data on screen
 * and no missing credentials, any other refusal — a spent quota, a secondary
 * limit, or an outage — is `warning`, and so is a stale cache (see
 * {@link prStaleness}). Everything else is `info`.
 *
 * `backoffInSeconds` reads `input.nextInSeconds` for every refusal kind — a
 * secondary limit's gate ends in seconds, same as a spent quota's, and the
 * caller has computed one number for whichever gate actually refused.
 * `resetApplies` answers a different question (whether a PRINTED reset time
 * describes the refusal) and is not consulted here.
 *
 * @param input - what the board already has about one PR read.
 * @returns the level, cause, backoff end, spenders and notices.
 */
export const prStatus = (input: PrStatusInput): PrStatus => {
  const { notices, remainder } = extractHostNotices(input.error);
  const kind = refusalKind(remainder);

  const backoffInSeconds = kind === null ? null : input.nextInSeconds;
  const credentialsMissing = missingCredentials(remainder);
  const stale =
    kind === null && !credentialsMissing && input.ageSeconds !== null
      ? prStaleness(input.ageSeconds, input.intervalSeconds, input.overdueSeconds ?? null)
      : null;

  return {
    level: prStatusLevel(kind, input.ageSeconds, input.intervalSeconds, credentialsMissing, input.overdueSeconds ?? null),
    kind,
    cause: kind === null ? null : remainder,
    backoffInSeconds,
    spenders: kind === 'secondary' ? input.spenders : null,
    notices,
    stale,
  };
};

/**
 * Whether data on screen with no refusal is stale, and why.
 *
 * With a known schedule, the data is stale only when the next scheduled read
 * is overdue by more than {@link PR_OVERDUE_GRACE_SECONDS}, or by more than
 * one interval where the interval is longer: a read the reader stretched for
 * the account's spend is on schedule however old the data is. With no
 * schedule known, the data is stale when it is older than twice the interval.
 *
 * @param ageSeconds - seconds since the data on screen was read.
 * @param intervalSeconds - the ordinary refresh interval.
 * @param overdueSeconds - seconds the next scheduled read is past due (0 while
 *   it is ahead), or null where no schedule is known.
 * @returns `overdue`, `aged`, or null where the data is not stale.
 */
export const prStaleness = (
  ageSeconds: number,
  intervalSeconds: number,
  overdueSeconds: number | null,
): PrStaleness | null => {
  if (intervalSeconds <= 0) return null;
  if (overdueSeconds !== null) {
    return overdueSeconds > Math.max(intervalSeconds, PR_OVERDUE_GRACE_SECONDS) ? 'overdue' : null;
  }
  return ageSeconds > intervalSeconds * 2 ? 'aged' : null;
};

/**
 * The level alone, for a caller that only needs the severity.
 *
 * @param kind - which limit refused, or null where nothing did.
 * @param ageSeconds - seconds since the data on screen was read, or null where
 *   no PR data has landed.
 * @param intervalSeconds - the refresh interval the age is measured against.
 * @param credentialsMissing - whether the refusal names missing credentials.
 *   The plan table calls this `error` whether or not data is on screen, unlike
 *   every other refusal kind.
 * @param overdueSeconds - seconds the next scheduled read is past due (0 while
 *   it is ahead), or null where no schedule is known.
 * @returns `error` where no data has landed, or credentials are missing;
 *   `warning` where data is on screen and a refusal is present or
 *   {@link prStaleness} calls the data stale; `info` otherwise.
 */
export const prStatusLevel = (
  kind: RefusalKind | null,
  ageSeconds: number | null,
  intervalSeconds: number,
  credentialsMissing = false,
  overdueSeconds: number | null = null,
): PrStatusLevel => {
  if (ageSeconds === null) return 'error';
  if (credentialsMissing) return 'error';
  if (kind !== null) return 'warning';
  if (prStaleness(ageSeconds, intervalSeconds, overdueSeconds) !== null) return 'warning';
  return 'info';
};
