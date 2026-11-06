/** One open slice PR the idle rule may judge. */
export interface SlicePr {
  /** The slice's branch. */
  branch: string;
  /** When the host recorded the PR as opened, ISO-8601. */
  createdAt: string;
}

/** One run-log line the idle rule reads, narrowed to what it needs. */
export interface SliceIdleRunLogLine {
  /** The slice's branch; a line naming no single branch never matches a slice. */
  branch: string;
  /** Which action the line records. */
  step: string;
  /** What the action came to; only `'moved'` resets a slice's clock. */
  outcome: string;
  /** When the action happened, ISO-8601. */
  at: string;
}

/** One slice's reading for the idle rule. */
export interface SliceIdleReading {
  /** The slice's open PR. */
  pr: SlicePr;
  /** Every run-log line naming this slice's branch, in any order. */
  lines: readonly SliceIdleRunLogLine[];
  /** Whether this slice's desk holds a live `PLOT-BLOCKED` marker. */
  blocked: boolean;
}

/** What the idle rule needs beyond each slice's own reading. */
export interface SliceIdleWorld {
  /** Every open slice PR to judge, with the readings behind each. */
  slices: readonly SliceIdleReading[];
  /** When the current fleetd process started, epoch milliseconds. */
  fleetdStartedAt: number;
  /** The configured `Slice idle after` bound, in milliseconds; `null` disables the rule. */
  boundMs: number | null;
  /** Every idle-notify episode already recorded, keyed by {@link idleEpisodeKey}. */
  recordedEpisodes: ReadonlySet<string>;
  /** The clock, for the age computation; `Date.now` when omitted. */
  now?(): number;
}

/** What the idle rule decided about one slice. */
export interface SliceIdleVerdict {
  /** The slice's branch. */
  branch: string;
  /** Whether the slice has gone idle past the bound. */
  idle: boolean;
  /** Whether this idle episode is absent from the recorded set. */
  isNew: boolean;
  /** The clock start the idle age is measured from, ISO-8601; includes fleetd's start. */
  clockStart: string;
  /** The clock start of the idle episode, ISO-8601 — half of the episode key; excludes fleetd's start. */
  episodeStart: string;
}

/**
 * The episode clock of a slice with no `moved` line and no parseable
 * `createdAt`: the Unix epoch. The `notified` run-log line stores the episode
 * clock in `at`, and the decoder drops a line whose `at` is empty, so the
 * clock needs a fixed non-empty value.
 */
export const UNMOVED_EPISODE_START = '1970-01-01T00:00:00.000Z';

/**
 * The episode key for one slice's idle period: the branch plus the episode
 * start that began it.
 *
 * The episode start is the latest of the slice's `moved` lines and its PR's
 * `createdAt`; fleetd's start is not part of it, so a restart keeps the key.
 * A new moving line changes the episode start and therefore the key, so a
 * fresh episode needs no second ledger — the `notified` lines already in the
 * run log are the recorded set.
 *
 * @param branch - the slice's branch.
 * @param episodeStart - the episode start, ISO-8601.
 * @returns the key, stable for the same branch and episode start.
 */
export const idleEpisodeKey = (branch: string, episodeStart: string): string => `${branch}\t${episodeStart}`;

/**
 * The latest of a slice's last moving line and its PR's `createdAt`, the
 * episode clock.
 *
 * A `failed` or `partial` line is evidence the loop tried, not evidence the
 * slice moved, so only `moved` lines count. An unparseable `createdAt` is
 * absent, not zero.
 *
 * @param reading - the slice's PR and its run-log lines.
 * @returns the episode start, epoch milliseconds; `null` where neither exists.
 */
const episodeStartMs = (reading: SliceIdleReading): number | null => {
  const movingTimes = reading.lines
    .filter((line) => line.branch === reading.pr.branch && line.outcome === 'moved')
    .map((line) => Date.parse(line.at))
    .filter((ms) => !Number.isNaN(ms));
  const createdAtMs = Date.parse(reading.pr.createdAt);
  const candidates = [...movingTimes, ...(Number.isNaN(createdAtMs) ? [] : [createdAtMs])];
  return candidates.length === 0 ? null : Math.max(...candidates);
};

/**
 * Which slices have gone idle, and which of those idle episodes are new.
 *
 * **ONLY `moved` LINES RESET A SLICE'S CLOCK.** A slice retrying a broken
 * correction every tick still reads idle, because `failed`/`partial` lines
 * never move it — getting this backwards would silently defeat the whole
 * notification.
 *
 * **IDLE IS STRICT `>` THE BOUND**, matching `questionEscalation`'s own
 * inequality. Exactly at the bound is not idle.
 *
 * **A SLICE WITH A LIVE `PLOT-BLOCKED` MARKER IS NEVER IDLE.** That
 * notification belongs to the question ladder; excluding a blocked slice here
 * is what keeps a person to one message instead of two for the same root
 * cause.
 *
 * **TWO CLOCKS.** The idle age counts from `max(fleetdStartedAt, last moved
 * line, createdAt)` (`clockStart`); the episode key uses `max(last moved line,
 * createdAt)` (`episodeStart`), so a fleetd restart delays the first
 * notification and never repeats one. A slice with neither keeps one key for
 * its whole life.
 *
 * **THIS RULE ONLY EVER ADDS INFORMATION.** A wrong answer costs one message
 * too many or too few; nothing else may come to depend on `{ idle, isNew }`.
 *
 * @param world - the open slice PRs and their readings, fleetd's start, the
 *   bound, the recorded episodes, and the clock.
 * @returns one verdict per slice in `world.slices`, in the same order.
 */
export const sliceIdle = (world: SliceIdleWorld): readonly SliceIdleVerdict[] => {
  const now = world.now ?? Date.now;
  const nowMs = now();
  return world.slices.map((reading): SliceIdleVerdict => {
    const episodeMs = episodeStartMs(reading);
    const episodeStart = episodeMs === null ? UNMOVED_EPISODE_START : new Date(episodeMs).toISOString();
    // The idle clock also floors at fleetd's start, so a just-restarted daemon
    // does not declare every slice idle it had no chance yet to act on.
    const start = Math.max(world.fleetdStartedAt, episodeMs ?? world.fleetdStartedAt);
    const clockStart = new Date(start).toISOString();
    if (reading.blocked || world.boundMs === null) {
      return { branch: reading.pr.branch, idle: false, isNew: false, clockStart, episodeStart };
    }
    const idle = nowMs - start > world.boundMs;
    const key = idleEpisodeKey(reading.pr.branch, episodeStart);
    const isNew = idle && !world.recordedEpisodes.has(key);
    return { branch: reading.pr.branch, idle, isNew, clockStart, episodeStart };
  });
};

/** The default `Slice idle after` value. */
export const DEFAULT_SLICE_IDLE_AFTER = '2h';

/** The `Slice idle after` value that disables the rule. */
export const SLICE_IDLE_AFTER_OFF = 'none';

/** One unit a duration may be written in, and its length in milliseconds. */
const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses one duration like `15m` or `2h` into milliseconds.
 *
 * @param text - the duration, trimmed.
 * @returns the duration in milliseconds, or `null` where it does not match a
 *   number followed by `s`, `m`, `h` or `d`.
 */
const parseDuration = (text: string): number | null => {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * UNIT_MS[match[2]];
};

/**
 * Parses a `Slice idle after` value into a bound in milliseconds.
 *
 * `none` (any case) and an empty string parse to `null`, which disables the
 * rule. `plot-config.sh` answers the default for a key whose value is empty,
 * so `none` is the value a repository writes to turn it off. A value that
 * does not parse gives the default's bound. Never throws.
 *
 * **WRAPS `parseQuestionEscalation`'S GRAMMAR, NOT A NEW PARSER.** That
 * function answers an ascending list of thresholds for a comma-separated
 * value; this key is one scalar bound, so the shapes do not match the call
 * site cleanly and this wraps the same unit table instead of reusing it
 * verbatim.
 *
 * @param configured - the `Slice idle after` value.
 * @returns the bound in milliseconds, or `null` to disable the rule.
 */
export const parseSliceIdleAfter = (configured: string): number | null => {
  const trimmed = configured.trim();
  if (trimmed === '' || trimmed.toLowerCase() === SLICE_IDLE_AFTER_OFF) return null;
  const parsed = parseDuration(trimmed);
  return parsed ?? parseDuration(DEFAULT_SLICE_IDLE_AFTER);
};
