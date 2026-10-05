/**
 * One rung a question's age may reach: `listed` at age 0, then one
 * `notified-N` per configured age, in order.
 *
 * `listed` IS THE BOARD'S OWN RUNG, and the adapter is never called for it
 * (see {@link questionEscalation}'s return). It exists as a rung at all so a
 * desk with no age past yet still has a value to compare against the record,
 * rather than a sentinel every caller must special-case.
 */
export type Rung = 'listed' | `notified-${number}`;

/** What one desk's question looked like at this tick. */
export interface QuestionReading {
  /** The desk's marker, or `null` where it holds none. */
  marker: { askedAt: string } | null;
  /** How old the marker is, in milliseconds — meaningless where `marker` is `null`. */
  ageMs: number;
  /** The configured escalation ages, in milliseconds, ascending — empty disables notification. */
  ages: readonly number[];
  /** Every rung already recorded for this desk path and this marker's modification time. */
  recordedRungs: ReadonlySet<Rung>;
}

/** What this tick decided about one desk's question. */
export interface QuestionEscalation {
  /** The highest rung the age has reached; `null` where there is no question at all. */
  rung: Rung | null;
  /** Whether `rung` is new — not yet in `recordedRungs` — and so needs a `notify` write. */
  isNew: boolean;
}

/** The answer for a desk holding no marker: nothing to escalate, nothing new. */
const NO_QUESTION: QuestionEscalation = { rung: null, isNew: false };

/**
 * Which rung a question's age has reached, and whether it is new.
 *
 * **PURE AND SYNCHRONOUS.** It takes the marker's presence and age, the
 * configured ages, and the rungs already recorded for this marker, and reads
 * no file and no clock — the caller takes every reading.
 *
 * **THE HIGHEST RUNG, NEVER A STEP THROUGH EACH ONE.** A desk first seen at an
 * age past several configured thresholds at once reaches the highest and skips
 * the rest, so one tick notifies once rather than once per threshold it has
 * already passed.
 *
 * **STRICTLY GREATER, NOT GREATER-OR-EQUAL.** `ageMs > ages[i]`, so a reading
 * taken at the exact configured age has not yet reached that rung — the next
 * tick, a minute later, is what crosses it.
 *
 * **`listed` IS NEVER NEW.** It is the board's own rung, carrying no
 * notification, so `isNew` is `false` whenever the answer is `listed` even on
 * a desk never seen before — the caller's adapter is reached only for
 * `notified-N`.
 *
 * @param reading - the marker, its age, the configured ages, and the rungs
 *   already recorded for this exact marker.
 * @returns the highest rung reached, and whether it is new.
 */
export const questionEscalation = (reading: QuestionReading): QuestionEscalation => {
  if (reading.marker === null) return NO_QUESTION;

  let rung: Rung = 'listed';
  for (let i = reading.ages.length - 1; i >= 0; i -= 1) {
    if (reading.ageMs > reading.ages[i]) {
      rung = `notified-${i + 1}`;
      break;
    }
  }

  if (rung === 'listed') return { rung, isNew: false };
  return { rung, isNew: !reading.recordedRungs.has(rung) };
};

/**
 * The default `Question escalation` value: three ages, fifteen minutes apart
 * at first and widening — the plan's own default.
 */
export const DEFAULT_QUESTION_ESCALATION = '15m, 1h, 4h';

/** One unit a duration may be written in, and its length in milliseconds. */
const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses one duration like `15m` or `4h` into milliseconds, or `null` where it
 * does not parse.
 *
 * @param text - the duration, trimmed.
 * @returns the duration in milliseconds, or `null`.
 */
const parseDuration = (text: string): number | null => {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(text);
  if (!match) return null;
  // BOTH CAPTURES ARE ALREADY VALID BY CONSTRUCTION. Group 1 is `\d+(?:\.\d+)?`,
  // so `Number(...)` is always finite; group 2 is the literal alternation
  // `(s|m|h|d)`, so it is always a key `UNIT_MS` holds. A guard against either
  // failing would be dead code the regex already made unreachable.
  return Number(match[1]) * UNIT_MS[match[2]];
};

/**
 * Parses a `Question escalation` value into ascending ages, in milliseconds.
 *
 * **AN EMPTY VALUE DISABLES NOTIFICATION.** `''` (or all-whitespace) parses to
 * `[]`, and {@link questionEscalation} given no ages answers `listed` only —
 * the board listing stays the one escalation.
 *
 * **A MALFORMED LIST FALLS BACK TO THE DEFAULT.** `15m, soon` holds an entry
 * `parseDuration` cannot read, so the whole value is rejected rather than
 * silently dropping the one entry a person meant to keep — falling back to
 * {@link DEFAULT_QUESTION_ESCALATION} is the same rule a sub-floor `Parallel
 * agents` config follows in `fleet-settings.ts`: a broken config is not a
 * reason to invent a narrower one.
 *
 * **NEVER THROWS.** Every input — empty, malformed, out of order — produces a
 * value, because a tick that cannot parse its config still has desks to read.
 *
 * @param configured - the `Question escalation` value, as `plot-config.sh`
 *   hands it back.
 * @returns the ages in milliseconds, ascending; empty for an explicitly empty
 *   config, the default's ages for anything malformed.
 */
export const parseQuestionEscalation = (configured: string): readonly number[] => {
  const trimmed = configured.trim();
  if (trimmed === '') return [];
  const parts = trimmed.split(',').map((part) => part.trim());
  const parsed = parts.map(parseDuration);
  if (parsed.some((ms) => ms === null)) {
    // THE DEFAULT, RE-PARSED RATHER THAN HARDCODED A SECOND TIME. A change to
    // the default's own text only ever needs to agree with itself here.
    return parseQuestionEscalation(DEFAULT_QUESTION_ESCALATION);
  }
  return (parsed as number[]).sort((a, b) => a - b);
};
