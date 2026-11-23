import type { LimitReading } from '../entities/limit.js';
import { DEFAULT_PREDICTED_HOST_LIMIT } from './declared-host-limit.js';

/**
 * `bb`'s request ledger, read and decided over values.
 *
 * A declared duplicate of the budget functions in `cli/bb` 1.15.0 (agent-skills
 * `2c904ab17`), held to them by `corpus/bb-ledger.corpus.test.ts`. The file IO
 * lives in `adapters/host/bb-ledger-file.ts`.
 */

/** The ceiling where `BB_HOURLY_LIMIT` is unset or empty (`BB_BUDGET_DEFAULT`). */
export const BB_HOURLY_DEFAULT = 800;

/** The window a request counts in, in seconds (`BB_BUDGET_WINDOW`). */
export const BB_BUDGET_WINDOW_S = 3600;

/** Seconds a pause may run past its length before it is stale (`BB_PAUSE_SKEW`). */
export const BB_PAUSE_SKEW_S = 5;

/** The length of a first pause after a 429, in seconds. */
const PAUSE_FIRST_S = 300;

/** The longest pause a repeated 429 doubles to, in seconds. */
const PAUSE_MAX_S = 3600;

/** What a number of more than 9 digits reads as. */
const CLAMP = 999_999_999;

const DIGITS = /^[0-9]+$/;

/** Removes leading zeros, as `bb`'s `${v#"${v%%[!0]*}"}` does. */
const unpadded = (digits: string): string => digits.replace(/^0+/, '');

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * The UTC hour stamp of an epoch second, as `date -u +%Y%m%d%H` prints it.
 *
 * @param second - epoch seconds.
 * @returns the stamp, `YYYYMMDDHH`.
 */
export const bbHourStamp = (second: number): string => {
  const at = new Date(second * 1000);
  return `${at.getUTCFullYear()}${pad2(at.getUTCMonth() + 1)}${pad2(at.getUTCDate())}${pad2(at.getUTCHours())}`;
};

/**
 * The hour stamps of the two request files the guard reads (`bb_hour_stamps`).
 *
 * @param second - epoch seconds.
 * @returns the stamp of the hour that holds `second`, and of the hour before.
 */
export const bbHourStamps = (second: number): { stamp: string; prev: string } => ({
  stamp: bbHourStamp(second),
  prev: bbHourStamp(second - BB_BUDGET_WINDOW_S),
});

/**
 * An epoch second as `HH:MM:SSZ` in UTC (`bb_utc_hms`).
 *
 * @param second - epoch seconds.
 * @returns the time of day.
 */
export const bbUtcHms = (second: number): string => {
  const at = new Date(second * 1000);
  return `${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())}:${pad2(at.getUTCSeconds())}Z`;
};

/**
 * A wait as `bb` shows it (`bb_shown_wait`): 429 reads as 430, so that no
 * refusal carries the digits of an HTTP 429.
 *
 * @param seconds - the wait.
 * @returns the shown wait.
 */
export const bbShownWait = (seconds: number): number => (seconds === 429 ? 430 : seconds);

/**
 * The text `bb_account_key` hashes: the email with ASCII `A`–`Z` lowercased
 * and every other character kept, as `tr '[:upper:]' '[:lower:]'` does under
 * the C locale.
 *
 * @param email - the account's email.
 * @returns the text to hash.
 */
export const bbKeyInput = (email: string): string => email.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The variables `bb_state_path` reads. */
export interface BbStateEnv {
  readonly BB_STATE_DIR?: string;
  readonly XDG_STATE_HOME?: string;
  readonly HOME?: string;
}

/**
 * The state directory, without the file system (`bb_state_path`).
 *
 * `BB_STATE_DIR`, else `$XDG_STATE_HOME/bb`, else `$HOME/.local/state/bb`. An
 * empty variable counts as unset.
 *
 * @param env - the variables.
 * @returns the path, or null where no variable gives one.
 */
export const bbStatePath = (env: BbStateEnv): string | null => {
  if (env.BB_STATE_DIR) return env.BB_STATE_DIR;
  if (env.XDG_STATE_HOME) return `${env.XDG_STATE_HOME}/bb`;
  if (env.HOME) return `${env.HOME}/.local/state/bb`;
  return null;
};

/**
 * The name of an account's request file for one hour.
 *
 * @param key - the account key.
 * @param stamp - the hour stamp.
 * @returns `requests-<key>-<stamp>.log`.
 */
export const bbRequestFileName = (key: string, stamp: string): string => `requests-${key}-${stamp}.log`;

/**
 * The name of an account's pause file.
 *
 * @param key - the account key.
 * @returns `pause-<key>`.
 */
export const bbPauseFileName = (key: string): string => `pause-${key}`;

/**
 * One request line, byte-exact: the epoch second in decimal digits and `\n`.
 *
 * @param second - epoch seconds.
 * @returns the line.
 */
export const bbRequestLine = (second: number): string => `${second}\n`;

/**
 * Whether `bb_budget_prune` deletes a file of the state directory.
 *
 * @param name - the file name.
 * @param prevStamp - the hour stamp of the previous hour.
 * @returns true for a request file of any account whose hour stamp is older.
 */
export const bbPrunes = (name: string, prevStamp: string): boolean => {
  const match = /^requests-.*-([^-]*)\.log$/.exec(name);
  return match !== null && /^[0-9]{10}$/.test(match[1]) && match[1] < prevStamp;
};

/** `BB_HOURLY_LIMIT` read by `bb`'s rule. */
export type BbHourlyLimit = { ok: true; limit: number } | { ok: false; said: string };

/**
 * `BB_HOURLY_LIMIT` read by `bb_hourly_limit`.
 *
 * Unset or empty is {@link BB_HOURLY_DEFAULT}; leading zeros do not count; `0`
 * turns the ceiling off; more than 9 digits reads as 999999999.
 *
 * @param value - the variable, or undefined where it is unset.
 * @returns the limit (0 for off), or `bb`'s error words for a value that is not
 *   a whole number.
 */
export const bbHourlyLimit = (value: string | undefined): BbHourlyLimit => {
  const raw = value === undefined || value === '' ? String(BB_HOURLY_DEFAULT) : value;
  if (!DIGITS.test(raw)) return { ok: false, said: `error: BB_HOURLY_LIMIT must be a whole number, got '${raw}'` };
  const digits = unpadded(raw);
  return { ok: true, limit: digits.length > 9 ? CLAMP : Number(digits || '0') };
};

/** The ceiling the client counts under. */
export type BbCeiling = { ok: true; ceiling: number | null } | { ok: false; said: string };

/**
 * The ceiling the in-process client applies.
 *
 * The smaller of `BB_HOURLY_LIMIT` (by {@link bbHourlyLimit}) and the declared
 * `Host rate limit`, where the key declares one. `BB_HOURLY_LIMIT=0` counts as
 * no ceiling, so the declared limit alone applies; with neither there is none.
 *
 * @param hourlyLimit - `BB_HOURLY_LIMIT`, or undefined where it is unset.
 * @param declaredLimit - the declared `Host rate limit`, or null where the key
 *   declares none. Never the default prediction.
 * @returns the ceiling (null for none), or `bb`'s error words for an invalid
 *   `BB_HOURLY_LIMIT`.
 */
export const bbCeiling = (hourlyLimit: string | undefined, declaredLimit: number | null): BbCeiling => {
  const hourly = bbHourlyLimit(hourlyLimit);
  if (!hourly.ok) return hourly;
  const limits = [hourly.limit > 0 ? hourly.limit : null, declaredLimit].filter((n): n is number => n !== null);
  return { ok: true, ceiling: limits.length === 0 ? null : Math.min(...limits) };
};

/** What the request files hold, counted by `bb_budget_count`. */
export interface BbCount {
  /** The requests of the last {@link BB_BUDGET_WINDOW_S} seconds. */
  readonly requests: number;
  /**
   * The epoch second at which the ceiling lets the next request through, or
   * null where the count is below the ceiling or there is none.
   */
  readonly freeAt: number | null;
}

/**
 * Counts the request lines of the previous and the current hour's files.
 *
 * A line counts where it is all digits, at most 12 characters, later than
 * `now - 3600` and not later than `now`. At the ceiling `c` the next free
 * second is the `(n - c + 1)`-th oldest counted line plus 3600.
 *
 * @param now - epoch seconds.
 * @param ceiling - the ceiling, or null for none.
 * @param texts - the files' text, previous hour first; `''` for a missing file.
 * @returns the count and the next free second.
 */
export const bbBudgetCount = (now: number, ceiling: number | null, texts: readonly string[]): BbCount => {
  const min = now - BB_BUDGET_WINDOW_S;
  const lines = texts.join('').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const seconds = lines
    .filter((line) => DIGITS.test(line) && line.length <= 12)
    .map(Number)
    .filter((second) => second > min && second <= now)
    .sort((a, b) => a - b);
  const n = seconds.length;
  const freeAt = ceiling !== null && ceiling > 0 && n >= ceiling ? seconds[n - ceiling] + BB_BUDGET_WINDOW_S : null;
  return { requests: n, freeAt };
};

/** A pause after a 429: the epoch second it ends, and its length in seconds. */
export interface BbPause {
  readonly end: number;
  readonly length: number;
}

/**
 * Reads a pause file's text (`bb_pause_read`).
 *
 * The first line must hold exactly two whole numbers of at most 12 digits,
 * leading zeros not counted, with a length above 0. Anything else is no pause.
 *
 * @param text - the file's text, or null where it is missing or unreadable.
 * @returns the pause, or null.
 */
export const bbPauseParse = (text: string | null): BbPause | null => {
  if (text === null) return null;
  const fields = text.split('\n')[0].split(/[ \t]+/).filter((field) => field !== '');
  if (fields.length !== 2 || !fields.every((field) => DIGITS.test(field))) return null;
  const [end, length] = fields.map(unpadded);
  if (end.length > 12 || length.length > 12) return null;
  const pause = { end: Number(end || '0'), length: Number(length || '0') };
  return pause.length > 0 ? pause : null;
};

/**
 * One pause line, byte-exact: `<end> <length>\n`.
 *
 * @param pause - the pause.
 * @returns the line.
 */
export const bbPauseLine = (pause: BbPause): string => `${pause.end} ${pause.length}\n`;

/**
 * Whether a pause is stale (`bb_pause_is_stale`): it has more than its length
 * plus {@link BB_PAUSE_SKEW_S} seconds left. A stale pause counts as none.
 *
 * @param pause - the pause.
 * @param now - epoch seconds.
 * @returns true where the pause is stale.
 */
export const bbPauseIsStale = (pause: BbPause, now: number): boolean =>
  pause.end > now && pause.end - now > pause.length + BB_PAUSE_SKEW_S;

/**
 * The seconds left of a pause (`bb_pause_left`).
 *
 * @param pause - the stored pause, or null.
 * @param now - epoch seconds.
 * @returns the seconds left, or null where there is no pause, it has ended or
 *   it is stale.
 */
export const bbPauseLeft = (pause: BbPause | null, now: number): number | null =>
  pause !== null && pause.end > now && !bbPauseIsStale(pause, now) ? pause.end - now : null;

/**
 * A `Retry-After` value as `bb_pause_after_429` reads it.
 *
 * @param raw - the header as sent, or null.
 * @returns the seconds, leading zeros not counted and more than 9 digits read
 *   as 999999999, or null where the value is not all digits.
 */
export const bbRetryAfter = (raw: string | null): number | null => {
  if (raw === null || !DIGITS.test(raw)) return null;
  const digits = unpadded(raw);
  return digits.length > 9 ? CLAMP : Number(digits || '0');
};

/**
 * The pause to store after a 429 (`bb_pause_after_429`).
 *
 * With no stored pause, or one that ended 3600 s ago or longer, the length is
 * 300 s; one that ended less than 3600 s ago doubles its length, at most
 * 3600 s; a `Retry-After` raises the length to at least its value, and the end
 * is `now + length`. A pause that is still active keeps the later of its end
 * and `now + Retry-After` (300 s without one), and the larger length. A stale
 * stored pause counts as none.
 *
 * @param stored - the stored pause, or null.
 * @param retryAfter - the `Retry-After` header as sent, or null.
 * @param now - epoch seconds.
 * @returns the pause to write.
 */
export const bbPauseAfter429 = (stored: BbPause | null, retryAfter: string | null, now: number): BbPause => {
  const ra = bbRetryAfter(retryAfter);
  const held = stored !== null && !bbPauseIsStale(stored, now) ? stored : null;
  if (held !== null && now < held.end) {
    const end = Math.max(held.end, now + (ra ?? PAUSE_FIRST_S));
    return { end, length: Math.max(held.length, end - now) };
  }
  const base = held !== null && now - held.end < PAUSE_MAX_S ? Math.min(held.length * 2, PAUSE_MAX_S) : PAUSE_FIRST_S;
  const length = ra !== null && ra > base ? ra : base;
  return { end: now + length, length };
};

/**
 * The pause that goes into place, merged with the one stored just before the
 * rename (`bb_pause_write`): a stored pause that is not stale and ends later
 * keeps its end and the larger length.
 *
 * @param next - the pause to write.
 * @param stored - the pause read again just before the rename, or null.
 * @param now - epoch seconds.
 * @returns the pause to rename into place.
 */
export const bbPauseMerge = (next: BbPause, stored: BbPause | null, now: number): BbPause =>
  stored !== null && stored.end > next.end && !bbPauseIsStale(stored, now)
    ? { end: stored.end, length: Math.max(stored.length, next.length) }
    : next;

/**
 * The tail of `bb`'s message after a 429: `bb paused until HH:MM:SSZ (in N s)`,
 * with `<host> asked to wait <raw> s; ` in front where `Retry-After` is all
 * digits.
 *
 * @param pause - the pause that stayed in place.
 * @param retryAfter - the `Retry-After` header as sent, or null.
 * @param now - epoch seconds.
 * @param host - the name `bb` gives its host in its words.
 * @returns the tail.
 */
export const bbPauseTail = (pause: BbPause, retryAfter: string | null, now: number, host: string): string => {
  const shown = bbShownWait(pause.end - now);
  const tail = `bb paused until ${bbUtcHms(now + shown)} (in ${shown} s)`;
  return retryAfter !== null && DIGITS.test(retryAfter) ? `${host} asked to wait ${retryAfter} s; ${tail}` : tail;
};

/** What the guard reads before one request. */
export interface BbGuardInput {
  /** Epoch seconds. */
  readonly now: number;
  /** The ceiling, or null for none. */
  readonly ceiling: number | null;
  /** The stored pause, or null. */
  readonly pause: BbPause | null;
  /**
   * The two request files' text, previous hour first, or null where a file
   * could not be read: the count is then unknown and the request goes out.
   */
  readonly texts: readonly string[] | null;
  /** The name `bb` gives its host in its words. */
  readonly host: string;
}

/** The guard's verdict on one request. */
export type BbGuardVerdict =
  | { readonly verdict: 'send'; readonly requests: number | null }
  | { readonly verdict: 'paused'; readonly waitSeconds: number; readonly said: string }
  | { readonly verdict: 'ceiling'; readonly waitSeconds: number; readonly said: string; readonly requests: number };

/**
 * Decides one request, in `bb_request_guard`'s order: the pause first, then
 * the count at the ceiling.
 *
 * The refusal words are `bb`'s, without its `error: ` prefix. The wait is the
 * shown wait in seconds, at least 1.
 *
 * @param input - the clock, the ceiling, the pause and the request files.
 * @returns `send` with the count before this request (null where unknown), or
 *   `paused` or `ceiling` with the wait and the words.
 */
export const bbGuard = (input: BbGuardInput): BbGuardVerdict => {
  const { now } = input;
  const left = bbPauseLeft(input.pause, now);
  if (left !== null) {
    const shown = bbShownWait(left);
    return {
      verdict: 'paused',
      waitSeconds: shown,
      said: `rate limited — bb paused until ${bbUtcHms(now + shown)} after ${input.host} refused a request (in ${shown} s)`,
    };
  }
  if (input.texts === null) return { verdict: 'send', requests: null };
  const count = bbBudgetCount(now, input.ceiling, input.texts);
  if (input.ceiling !== null && count.freeAt !== null) {
    const shown = bbShownWait(Math.max(count.freeAt - now, 1));
    return {
      verdict: 'ceiling',
      waitSeconds: shown,
      requests: count.requests,
      said: `rate limited — ${count.requests} requests in the last hour from this machine; next request at ${bbUtcHms(now + shown)} (in ${shown} s)`,
    };
  }
  return { verdict: 'send', requests: count.requests };
};

/** The fields of `bb rate-limit --json`, plus what only the client knows. */
export interface BbLimitFields {
  /** Requests in the last hour, or null where the count is unknown. */
  readonly requests: number | null;
  /** The ceiling, or null where there is none. */
  readonly ceiling: number | null;
  /** The epoch second a pause ends, or null where none holds. */
  readonly pausedUntil: number | null;
  /** Seconds until a request can go out, 0 where one can now. */
  readonly waitSeconds: number;
  /** The epoch second the ceiling lets the next request through, where the request lines are known. */
  readonly nextFreeAt?: number | null;
}

/** The fallback reset where nothing names one, in milliseconds. */
const UNNAMED_RESET_MS = BB_BUDGET_WINDOW_S * 1000;

/**
 * The limit reading of `bb`'s ledger, basis `predicted`.
 *
 * `limit` is the ceiling, the smaller of it and the declared limit where one is
 * declared, and the prediction where there is no ceiling. `remaining` is
 * `limit - requests`, floored at 0, null where the count is unknown or there is
 * no ceiling, and 0 while a pause holds. Where `remaining` is 0, `resetAt` is
 * the pause's end, else `now + waitSeconds` where that is above 0, else the
 * next free second, else `now + 3600` s; it is never null then. Otherwise it
 * is null.
 *
 * @param fields - `bb rate-limit --json`'s fields, in epoch seconds.
 * @param declared - the declared `Host rate limit`, or null where none is declared.
 * @param now - epoch milliseconds.
 * @param connector - the connector's backend word.
 * @returns the reading for the connector's `api` bucket.
 */
export const bbLimitReading = (
  fields: BbLimitFields,
  declared: number | null,
  now: number,
  connector: string,
): LimitReading => {
  const ceiling = fields.ceiling !== null && fields.ceiling > 0 ? fields.ceiling : null;
  const limit =
    ceiling === null ? (declared ?? DEFAULT_PREDICTED_HOST_LIMIT) : declared === null ? ceiling : Math.min(ceiling, declared);
  const paused = fields.pausedUntil !== null && fields.pausedUntil * 1000 > now;
  const remaining = paused
    ? 0
    : fields.requests === null || ceiling === null
      ? null
      : Math.max(0, limit - fields.requests);
  const resetAt =
    remaining !== 0
      ? null
      : paused
        ? (fields.pausedUntil as number) * 1000
        : fields.waitSeconds > 0
          ? now + fields.waitSeconds * 1000
          : fields.nextFreeAt != null
            ? fields.nextFreeAt * 1000
            : now + UNNAMED_RESET_MS;
  return { connector, bucket: 'api', limit, remaining, resetAt, basis: 'predicted' };
};

/** Which limit a Bitbucket throttle hit. */
export type BbThrottleCause = 'ceiling' | 'paused' | 'host';

/**
 * Which limit a Bitbucket throttle hit, from `bb`'s fixed phrases.
 *
 * Reads the client's refusal words and `bb`'s stderr alike.
 *
 * @param said - the refusal's words.
 * @returns `ceiling` for this machine's hourly ceiling, `paused` for a pause
 *   after an earlier 429, `host` for everything else.
 */
export const bbThrottleCause = (said: string): BbThrottleCause => {
  if (/requests in the last hour from this machine; next request at/.test(said)) return 'ceiling';
  if (/bb paused until \S+ after \S+ refused a request/.test(said)) return 'paused';
  return 'host';
};

/**
 * The time of day a `bb` refusal names: the next request of a ceiling, or the
 * end of a pause.
 *
 * @param said - the refusal's words.
 * @returns `HH:MM:SSZ`, or null where the words name none.
 */
export const bbThrottleTime = (said: string): string | null =>
  /(?:next request at|bb paused until) (\d\d:\d\d:\d\dZ)/.exec(said)?.[1] ?? null;

/**
 * The wait a `bb` refusal names in its `(in N s)`.
 *
 * @param said - the refusal's words.
 * @returns the seconds, or null where the words name none.
 */
export const bbRefusalWaitSeconds = (said: string): number | null => {
  const match = /\(in (\d+) s\)/.exec(said);
  return match === null ? null : Number(match[1]);
};
