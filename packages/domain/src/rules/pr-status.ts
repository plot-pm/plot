import { refusalKind, resetApplies, type RefusalKind } from './refusal.js';

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
 * A notice is one of the informational lines `skills/plot/scripts/plot-host.sh`
 * writes to stderr: `<backend> ignores --limit`, `<backend> pr-list state=<s>
 * page complete`, `pr-list sweep complete`, and the `… read from <source>`
 * credential-source lines. Each reports something true about the read and
 * never a failure. `plot-host` writes its failures with the same `plot-host: `
 * prefix, so the prefix alone does not make a line a notice.
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
  /(?:JENKINS_USER and JENKINS_API_TOKEN|JIRA_EMAIL and JIRA_API_TOKEN) read from \S+/,
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
  /** The refresh interval the age is measured against, in seconds. */
  intervalSeconds: number;
}

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
 * is `error`, whatever the refusal. With data on screen, any refusal — a spent
 * quota, a secondary limit, or an outage — is `warning`, and so is a cache
 * older than twice the refresh interval. Everything else is `info`.
 *
 * `resetApplies` decides whether `nextInSeconds` describes the refusal, so a
 * secondary limit's or an outage's backoff field is null even where a number
 * is available.
 *
 * @param input - what the board already has about one PR read.
 * @returns the level, cause, backoff end, spenders and notices.
 */
export const prStatus = (input: PrStatusInput): PrStatus => {
  const { notices, remainder } = extractHostNotices(input.error);
  const kind = refusalKind(remainder);

  const backoffInSeconds =
    kind !== null && resetApplies(kind) ? input.nextInSeconds : null;

  return {
    level: prStatusLevel(kind, input.ageSeconds, input.intervalSeconds),
    kind,
    cause: kind === null ? null : remainder,
    backoffInSeconds,
    spenders: kind === 'secondary' ? input.spenders : null,
    notices,
  };
};

/**
 * The level alone, for a caller that only needs the severity.
 *
 * @param kind - which limit refused, or null where nothing did.
 * @param ageSeconds - seconds since the data on screen was read, or null where
 *   no PR data has landed.
 * @param intervalSeconds - the refresh interval the age is measured against.
 * @returns `error` where no data has landed; `warning` where data is on screen
 *   and a refusal is present or the age exceeds twice the interval; `info`
 *   otherwise.
 */
export const prStatusLevel = (
  kind: RefusalKind | null,
  ageSeconds: number | null,
  intervalSeconds: number,
): PrStatusLevel => {
  if (ageSeconds === null) return 'error';
  if (kind !== null) return 'warning';
  if (intervalSeconds > 0 && ageSeconds > intervalSeconds * 2) return 'warning';
  return 'info';
};
