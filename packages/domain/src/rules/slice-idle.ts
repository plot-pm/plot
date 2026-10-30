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
  /** The clock start this verdict was computed from, ISO-8601 — half of the episode key. */
  clockStart: string;
}

/**
 * The episode key for one slice's idle period: the branch plus the clock
 * start that began it.
 *
 * A new moving line changes the clock start and therefore the key, so a fresh
 * episode needs no second ledger — the `notified` lines already in the run
 * log are the recorded set.
 *
 * @param branch - the slice's branch.
 * @param clockStart - the clock start, ISO-8601.
 * @returns the key, stable for the same branch and clock start.
 */
export const idleEpisodeKey = (branch: string, clockStart: string): string => `${branch}\t${clockStart}`;

/**
 * The time a slice's idle clock starts counting from: the latest of its last
 * moving line, its PR's `createdAt`, and fleetd's own start.
 *
 * A `failed` or `partial` line is evidence the loop tried, not evidence the
 * slice moved, so only `moved` lines count. Fleetd's start is always in the
 * mix so a just-restarted daemon does not declare every slice idle it had no
 * chance yet to act on.
 *
 * @param reading - the slice's PR and its run-log lines.
 * @param fleetdStartedAt - when the current fleetd process started, epoch milliseconds.
 * @returns the clock start, epoch milliseconds.
 */
const clockStartMs = (reading: SliceIdleReading, fleetdStartedAt: number): number => {
  const movingTimes = reading.lines
    .filter((line) => line.branch === reading.pr.branch && line.outcome === 'moved')
    .map((line) => Date.parse(line.at))
    .filter((ms) => !Number.isNaN(ms));
  const createdAtMs = Date.parse(reading.pr.createdAt);
  const candidates = [fleetdStartedAt, ...movingTimes, ...(Number.isNaN(createdAtMs) ? [] : [createdAtMs])];
  return Math.max(...candidates);
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
    const start = clockStartMs(reading, world.fleetdStartedAt);
    const clockStart = new Date(start).toISOString();
    if (reading.blocked || world.boundMs === null) {
      return { branch: reading.pr.branch, idle: false, isNew: false, clockStart };
    }
    const idle = nowMs - start > world.boundMs;
    const key = idleEpisodeKey(reading.pr.branch, clockStart);
    const isNew = idle && !world.recordedEpisodes.has(key);
    return { branch: reading.pr.branch, idle, isNew, clockStart };
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
