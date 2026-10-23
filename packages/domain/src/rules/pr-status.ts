import { refusalKind, resetApplies, type RefusalKind } from './refusal.js';

/**
 * The three severities the PR footer may show — a display axis, not a failure
 * kind. {@link RefusalKind} names WHICH limit refused; this names how urgent
 * that refusal reads to someone looking at the board.
 *
 * `info`     the data is fresh, or there is no refusal to report.
 * `warning`  the data is stale, or the host says the page may be incomplete,
 *            but something is still on screen.
 * `error`    there is no data at all, or the host refuses outright (no
 *            credentials, an outage with nothing cached yet).
 */
export type PrStatusLevel = 'info' | 'warning' | 'error';

/**
 * One `plot-host` notice extracted from a combined error string.
 *
 * `plot-host` writes every notice to stderr prefixed `plot-host: `
 * (`skills/plot/scripts/plot-host.sh`'s `ignores --limit` and
 * `pr_list_report_complete` lines), and the adapter joins that stream with
 * whatever failure text accompanies it into the one string the board receives
 * as `prError`. A notice reports something true about the page — it ignored a
 * flag, or a page came back complete — and never a failure, so it must not
 * read as one.
 */
export interface HostNotice {
  /** The notice text, with the `plot-host: ` prefix removed. */
  text: string;
}

/**
 * Splits `plot-host`'s own notices out of a combined error string.
 *
 * READS OFF THE ONE MARKER `plot-host` ALWAYS WRITES: every notice line starts
 * `plot-host: `, so a segment starting there — up to the next such marker or
 * the end of the string — is a notice, and whatever is left is the actual
 * failure text (or nothing, where the whole string was notices). This is the
 * seam the plan's own open question asks about: `plot-host` has no structured
 * channel for a notice today, so the split is necessarily textual, done once,
 * here, rather than re-matched ad hoc at the rendering layer.
 *
 * @param message - the host CLI's stderr, or null where nothing failed.
 * @returns the notices found (empty where none), and the message with every
 *   notice segment removed and surrounding whitespace collapsed.
 */
export const extractHostNotices = (
  message: string | null,
): { notices: HostNotice[]; remainder: string | null } => {
  if (!message) return { notices: [], remainder: message };
  const pattern = /plot-host:\s*([^]*?)(?=\s*plot-host:|$)/g;
  const notices: HostNotice[] = [];
  let remainder = message;
  for (const match of message.matchAll(pattern)) {
    notices.push({ text: match[1].trim() });
  }
  if (notices.length > 0) {
    remainder = message.replace(pattern, '').trim();
  }
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
 * with no wording chosen. `host-notes.ts`'s `prNote` reads this and composes
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
 * THE LEVEL FOLLOWS THE DATA, NOT THE REFUSAL ALONE. A refusal with nothing
 * cached yet (`ageSeconds === null`) is `error` — there is nothing on screen.
 * A refusal with data still showing is `warning` — stale, but present. No
 * refusal at all is `warning` only where the cache has aged past twice the
 * refresh interval (the plan's own 2x rule), and `info` otherwise.
 *
 * THE KIND DECIDES NEITHER BY ITSELF. `quota` and `secondary` both read as
 * `warning` while data is on screen, because both are temporary and partial —
 * `2026-08-20-a-rate-limit-is-not-an-outage.md`'s distinction, extended here
 * to severity rather than wording. An `outage` with nothing on screen reads
 * `error` for the same reason a missing credential does: there is no data and
 * no known end.
 *
 * THE BACKOFF IS NEVER RE-DERIVED. `resetApplies` already decides whether
 * `nextInSeconds` describes the refusal that fired — reused here exactly as
 * `prNote` uses it today, so a secondary limit's backoff field stays null even
 * though a number is available.
 *
 * @param input - what the board already has about one PR read.
 * @returns the level, cause, backoff end, spenders and notices.
 */
export const prStatus = (input: PrStatusInput): PrStatus => {
  const kind = refusalKind(input.error);
  const { notices, remainder } = extractHostNotices(input.error);
  const hasData = input.ageSeconds !== null;

  const backoffInSeconds =
    kind !== null && resetApplies(kind) ? input.nextInSeconds : null;

  const level = prStatusLevel(kind, hasData, input.ageSeconds, input.intervalSeconds);

  return {
    level,
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
 * Exported separately because the plan's Done-when table is asserted per row
 * against this one decision, with no cause or backoff involved.
 *
 * @param kind - which limit refused, or null where nothing did.
 * @param hasData - whether any PR data has ever landed.
 * @param ageSeconds - seconds since the data on screen was read, or null.
 * @param intervalSeconds - the refresh interval the age is measured against.
 * @returns the severity the footer should show.
 */
export const prStatusLevel = (
  kind: RefusalKind | null,
  hasData: boolean,
  ageSeconds: number | null,
  intervalSeconds: number,
): PrStatusLevel => {
  if (!hasData) return 'error';
  if (kind === 'outage') return 'error';
  if (kind === 'quota' || kind === 'secondary') return 'warning';
  if (ageSeconds !== null && intervalSeconds > 0 && ageSeconds > intervalSeconds * 2) {
    return 'warning';
  }
  return 'info';
};
