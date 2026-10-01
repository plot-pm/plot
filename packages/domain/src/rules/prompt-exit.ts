/**
 * What one prompt exit was, and whether the loop may wait for it.
 *
 * A harness that stops on the account's usage limit exits like a prompt that
 * could not start, and the loop read it as one: measured 2026-10-01 in #1141, a
 * worker spent three retries in 974 ms and wrote a marker telling a person to
 * fix a prompt file that worked, on a desk holding two pushed commits and ten
 * uncommitted files. The limit message names its own reset time, and nothing
 * read it.
 *
 * *Is this exit a usage limit, may the loop wait for it, and if not, how does
 * the worker end?* is one decision, so it is one rule. **The message patterns
 * arrive as an argument.** What a harness prints at a limit is a fact about
 * that harness, held in `adapters/harness/limit-lines.ts` as data; this file
 * imports no adapter and names no vendor, which is what makes a second harness
 * an adapter change.
 *
 * **Every instant goes out twice**, as epoch seconds and as UTC ISO text, so
 * the loop, the monitor and `plot-fleetctl.sh` compare integers and never parse
 * a date.
 */

/**
 * What a harness prints when it stops on a usage limit.
 *
 * Supplied by the caller from the harness table. A harness the table does not
 * know supplies no patterns, and every exit from it reads as it did before this
 * rule existed.
 */
export interface LimitPatterns {
  /** The text every limit line opens with, before the limit's name. */
  readonly prefix: string;
  /** The limit names the harness reports, each complete as it is printed. */
  readonly names: readonly string[];
  /** What separates the limit from its reset time on the same line. */
  readonly resetSeparator: string;
}

/** What the caller measured about the exit it is asking about. */
export interface PromptExitInput {
  /** The prompt's exit status. */
  readonly status: number;
  /** The last lines of the prompt's output, newest last. */
  readonly output: string;
  /** Now, in epoch seconds. */
  readonly now: number;
  /** `Worker bound` in seconds; `0` disables the cap. */
  readonly boundSeconds: number;
  /** How long the prompt ran, in seconds. */
  readonly ranSeconds: number;
  /** Whether this prompt started after a limit wait. */
  readonly afterWait: boolean;
  /** Commits the desk gained since that wait began. */
  readonly commitsSinceWait: number;
}

/** Why no wait is allowed for a limit that was found. */
export type LimitCause = 'no-reset' | 'past-bound' | 'no-progress';

/** A reset instant the rule could read. */
export interface ResetInstant {
  /** The reset in epoch seconds. */
  readonly epoch: number;
  /** The same instant as UTC ISO text. */
  readonly iso: string;
}

/**
 * What the exit was.
 *
 * - `wait`: a limit, a known reset at or after now, and the wait is allowed.
 * - `end-limited`: a limit, and no wait is allowed; `cause` says which gate.
 * - `unstarted`: no limit, and a non-zero status — the retry path.
 * - `ran`: no limit, and a status of 0.
 */
export type PromptExit =
  | { readonly answer: 'wait'; readonly reset: ResetInstant; readonly line: string }
  | {
      readonly answer: 'end-limited';
      readonly reset?: ResetInstant;
      readonly line: string;
      readonly cause: LimitCause;
    }
  | { readonly answer: 'unstarted' }
  | { readonly answer: 'ran' };

/**
 * A reset already past by no more than this resolves to now rather than to
 * tomorrow.
 *
 * The harness prints the reset and the loop reads it moments later, so a
 * message read three seconds after `5:20pm` would otherwise resolve 24 h ahead
 * and hold a working agent for a day.
 */
const PAST_RESET_GRACE_SECONDS = 120;

/** A prompt that met a limit again inside this ran too briefly to have worked. */
const PROGRESS_WINDOW_SECONDS = 600;

/** Seconds in the day a past reset is moved forward by. */
const DAY_SECONDS = 86400;

/** The instant as epoch seconds and UTC ISO text. */
const instant = (epoch: number): ResetInstant => ({
  epoch,
  iso: new Date(epoch * 1000).toISOString(),
});

/**
 * The wall-clock fields a zone shows at one instant.
 *
 * `Intl` is the only zone database available without a dependency, and it reads
 * forwards — instant to wall clock. Resolving a reset needs the inverse, which
 * is built from this in `resolveReset`.
 */
const zoneFields = (epochMs: number, zone: string): { readonly [k: string]: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));

  const fields: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      fields[part.type] = Number(part.value);
    }
  }
  return fields;
};

/**
 * The instant at which a zone's wall clock reads the given date and time.
 *
 * **Read forwards twice, then corrected.** `Intl` answers *what does this zone
 * show at this instant*; this needs the opposite. So the wanted wall clock is
 * first treated as if it were UTC, the zone is asked what it shows there, and
 * the difference between that and the wanted clock is the zone's offset at
 * about that moment. Applying it gives a candidate, and asking once more
 * corrects the case where the offset differs at the candidate itself — a reset
 * falling on a DST transition, where the first offset read is the wrong side of
 * the change.
 *
 * **TWO PASSES AND NO MORE, WHICH DECIDES A WALL CLOCK THAT NEVER HAPPENED.**
 * A time inside a spring-forward gap — 02:30 on 2026-03-29 in `Europe/Zurich`,
 * where the clocks jump 02:00 to 03:00 — corresponds to no instant, and the
 * correction oscillates: measured over every minute of both 2026 transition
 * days, 2820 of 2880 readings converge after one correction and 60 never
 * converge at all. The cap resolves those to the instant one hour after the
 * stated time, which is the hour the zone skipped. It takes the zone as known,
 * because `resolveReset` has already asked it for the date of now.
 */
const instantInZone = (
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  zone: string,
): number => {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);

  let candidate = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = zoneFields(candidate, zone);
    const asUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
    );
    const drift = wanted - asUtc;
    if (drift === 0) {
      return candidate;
    }
    candidate += drift;
  }
  return candidate;
};

/** A 12-hour clock time and the IANA zone it is stated in, as the message gives them. */
const RESET_TIME = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b[^(]*\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)+)\)/i;

/**
 * The instant a reset refers to, resolved on the date of now in its own zone.
 *
 * A reset up to `PAST_RESET_GRACE_SECONDS` in the past resolves to now, so the
 * loop sleeps only the margin. One further past than that resolves to the next
 * day, because the harness states a time of day and not a date.
 *
 * Returns `undefined` where the time or the zone cannot be read, which is
 * `no-reset` and never a guess.
 */
const resolveReset = (text: string, now: number): number | undefined => {
  const match = RESET_TIME.exec(text);
  if (!match) {
    return undefined;
  }

  const [, rawHour, rawMinute, meridiem, zone] = match;
  const hour12 = Number(rawHour);
  if (hour12 < 1 || hour12 > 12) {
    return undefined;
  }
  const minute = rawMinute === undefined ? 0 : Number(rawMinute);
  if (minute > 59) {
    return undefined;
  }

  const pm = meridiem.toLowerCase() === 'pm';
  const hour = pm ? (hour12 === 12 ? 12 : hour12 + 12) : hour12 === 12 ? 0 : hour12;

  let today: { readonly [k: string]: number };
  try {
    today = zoneFields(now * 1000, zone);
  } catch {
    return undefined;
  }

  const resolved = instantInZone(
    { year: today.year, month: today.month, day: today.day, hour, minute },
    zone,
  );

  const epoch = Math.floor(resolved / 1000);
  if (epoch >= now) {
    return epoch;
  }
  return now - epoch <= PAST_RESET_GRACE_SECONDS ? now : epoch + DAY_SECONDS;
};

/** Whether one line opens with the harness's prefix and a limit it names. */
const isLimitLine = (line: string, patterns: LimitPatterns): boolean => {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith(patterns.prefix)) {
    return false;
  }
  const rest = trimmed.slice(patterns.prefix.length);
  return patterns.names.some((name) => rest.startsWith(name));
};

/**
 * The limit line the output carries, or `undefined`.
 *
 * **A non-zero exit is matched across every line**; a status of 0 is matched
 * against the last non-empty line only. A `-p` run prints the agent's final
 * message, and plans, panel files and fixtures on this estate quote the #1141
 * line verbatim, so an agent that finished a slice while quoting it must read
 * `ran` rather than wait up to 24 h on finished work.
 */
const limitLine = (
  output: string,
  status: number,
  patterns: LimitPatterns,
): string | undefined => {
  const lines = output.split('\n').map((line) => line.trimEnd());

  if (status !== 0) {
    return lines.find((line) => isLimitLine(line, patterns));
  }

  const last = lines.filter((line) => line.trim() !== '').pop();
  return last !== undefined && isLimitLine(last, patterns) ? last : undefined;
};

/**
 * Classifies one prompt exit.
 *
 * Four answers, and `cause` on `end-limited` says which gate refused the wait:
 *
 * - `no-reset` — the line named a limit whose reset could not be read. A `fast
 *   limit` and a `monthly spend limit` land here until their shapes are
 *   measured, which is right for a spend cap: the marker names the limit and
 *   asks for a person.
 * - `past-bound` — the reset is further away than `Worker bound`. A bound of 0
 *   disables that cap, and a resolved reset is never more than 24 h out.
 * - `no-progress` — the prompt started after a wait, ran under
 *   `PROGRESS_WINDOW_SECONDS`, and the desk gained no commit since the wait. A
 *   limit that does not lift cannot hold an agent forever.
 *
 * **With `afterWait` false the run time and the commit count are not read**, so
 * an exit from a prompt that never waited can never answer `no-progress`.
 * Progress counts commits rather than transcript writes because the transcript
 * gains a line on the turn that meets the limit, so it cannot tell a prompt
 * that worked from one that only met the limit again.
 *
 * @param input - the status, output, clock, bound and wait readings.
 * @param patterns - the harness's limit patterns, or `undefined` for a harness
 *   the table does not know.
 * @returns the answer, with the reset instant and limit line where it found one.
 */
export const promptExit = (
  input: PromptExitInput,
  patterns: LimitPatterns | undefined,
): PromptExit => {
  const byStatus = (): PromptExit =>
    input.status === 0 ? { answer: 'ran' } : { answer: 'unstarted' };

  if (!patterns || patterns.names.length === 0) {
    return byStatus();
  }

  const line = limitLine(input.output, input.status, patterns);
  if (line === undefined) {
    return byStatus();
  }

  const after = line.split(patterns.resetSeparator).slice(1).join(patterns.resetSeparator);
  const epoch = after === '' ? undefined : resolveReset(after, input.now);
  if (epoch === undefined) {
    return { answer: 'end-limited', line, cause: 'no-reset' };
  }

  const reset = instant(epoch);

  if (input.boundSeconds > 0 && epoch - input.now > input.boundSeconds) {
    return { answer: 'end-limited', reset, line, cause: 'past-bound' };
  }

  if (
    input.afterWait &&
    input.ranSeconds < PROGRESS_WINDOW_SECONDS &&
    input.commitsSinceWait === 0
  ) {
    return { answer: 'end-limited', reset, line, cause: 'no-progress' };
  }

  return { answer: 'wait', reset, line };
};
