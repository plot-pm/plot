/**
 * One rung a question's age may reach: `listed` at age 0, then one
 * `notified-N` per configured age, in order. `listed` carries no notification.
 */
export type Rung = 'listed' | `notified-${number}`;

/** What one desk's question looked like at this tick. */
export interface QuestionReading {
  /** The desk's marker, or `null` where it holds none. */
  marker: { askedAt: string } | null;
  /** How old the marker is, in milliseconds; ignored where `marker` is `null`. */
  ageMs: number;
  /** The configured escalation ages, in milliseconds, ascending; empty disables notification. */
  ages: readonly number[];
  /** Every rung already recorded for this desk path and this marker's modification time. */
  recordedRungs: ReadonlySet<Rung>;
}

/** What this tick decided about one desk's question. */
export interface QuestionEscalation {
  /** The highest rung the age has reached; `null` where there is no question. */
  rung: Rung | null;
  /** Whether `rung` is a `notified-N` rung absent from `recordedRungs`. */
  isNew: boolean;
}

/** The answer for a desk holding no marker. */
const NO_QUESTION: QuestionEscalation = { rung: null, isNew: false };

/**
 * Which rung a question's age has reached, and whether it is new.
 *
 * The rung is `notified-N` for the highest configured age `N` that `ageMs`
 * strictly exceeds, and `listed` where it exceeds none. An age past several
 * thresholds gives only the highest rung. `listed` is never new.
 *
 * @param reading - the marker, its age, the configured ages, and the rungs
 *   already recorded for this marker.
 * @returns the highest rung reached, and whether it is new; `{ rung: null,
 *   isNew: false }` where the desk holds no marker.
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

/** The default `Question escalation` value. */
export const DEFAULT_QUESTION_ESCALATION = '15m, 1h, 4h';

/** The `Question escalation` value that disables notification. */
export const QUESTION_ESCALATION_OFF = 'none';

/** One unit a duration may be written in, and its length in milliseconds. */
const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses one duration like `15m` or `4h` into milliseconds.
 *
 * @param text - the duration, trimmed.
 * @returns the duration in milliseconds, or `null` where it does not match
 *   a number followed by `s`, `m`, `h` or `d`.
 */
const parseDuration = (text: string): number | null => {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * UNIT_MS[match[2]];
};

/**
 * Parses a `Question escalation` value into ascending ages, in milliseconds.
 *
 * `none` (any case) and an empty string parse to `[]`, which disables
 * notification. `plot-config.sh` answers the default for a key whose value
 * is empty, so `none` is the value a repository writes to turn it off. A list
 * holding any entry that does not parse gives the default's ages. Never
 * throws.
 *
 * @param configured - the `Question escalation` value.
 * @returns the ages in milliseconds, ascending.
 */
export const parseQuestionEscalation = (configured: string): readonly number[] => {
  const trimmed = configured.trim();
  if (trimmed === '' || trimmed.toLowerCase() === QUESTION_ESCALATION_OFF) return [];
  const parts = trimmed.split(',').map((part) => part.trim());
  const parsed = parts.map(parseDuration);
  if (parsed.some((ms) => ms === null)) {
    return parseQuestionEscalation(DEFAULT_QUESTION_ESCALATION);
  }
  return (parsed as number[]).sort((a, b) => a - b);
};
