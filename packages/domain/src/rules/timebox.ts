/**
 * Where a sprint sits against its own dates.
 *
 * A timebox nobody can see has passed is a timebox that is not doing its job,
 * so this is the fact a sprint card renders beside its dates.
 *
 * - `none`     the file names no usable dates. Hand-written sprint files
 *              predate the fields, so this is an ABSENCE and not an error.
 * - `upcoming` today is before the start.
 * - `running`  today is inside the box, ends included.
 * - `late`     today is past the end.
 *
 * `late` IS THE WORD `transitions/sprint.ts:9` ALREADY USES: *"a sprint past
 * its `plannedEnd` is late rather than closed, and nothing may close it on the
 * calendar's word."* This rule reports that fact and closes nothing — the same
 * shape `plot-reconcile-scan.sh`'s section 15 takes for a shipped release.
 *
 * A sprint's STATE is not consulted. The state is stated in the file and the
 * dates are stated beside it, so a Closed sprint whose end has passed is not a
 * disagreement to resolve here: a caller that wants to show the timebox only
 * while the sprint is open tests the state itself.
 */
export type TimeboxStanding = 'none' | 'upcoming' | 'running' | 'late';

/**
 * A sprint's two dates and the day to judge them against.
 *
 * **EVERY FIELD IS A READING**, and each is the string its source spells.
 * `start` and `end` are `- **Start:**` and `- **End:**` as the sprint file
 * writes them; `today` is the caller's clock, read through the clock port
 * rather than here, because a rule that reads the time cannot be tested
 * against a date that matters.
 */
export interface TimeboxReadings {
  /** The `- **Start:**` value, `''` where the file names none. */
  start: string;
  /** The `- **End:**` value, `''` where the file names none. */
  end: string;
  /** Today, ISO-8601 `YYYY-MM-DD`. */
  today: string;
}

/**
 * Whether a date is one this rule can compare.
 *
 * ISO-8601 `YYYY-MM-DD` and nothing else, because the comparison is a string
 * comparison: that format sorts lexicographically iff it is exactly ten
 * characters of the right shape, and `2026-9-6` would sort after `2026-10-01`.
 * A file writing anything else reads as having named no date.
 *
 * @param value - the field as the file spells it.
 * @returns true when the value can be compared.
 */
const comparable = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Where a sprint sits against its dates.
 *
 * **A MISSING OR MALFORMED DATE IS NOT A FAILURE.** Sprint files are written by
 * hand and some predate the fields, so an unusable date answers `none` and the
 * card renders no timebox rather than a placeholder or an error.
 *
 * The two dates are judged independently: a file naming only an end still
 * reports `late` once that end has passed, because that is the half of the
 * timebox worth seeing. A file naming only a start reports `running` from that
 * day, since nothing says when it stops.
 *
 * @param readings - the sprint's dates and today.
 * @returns the standing, or `none` where no usable date was named.
 */
export const timeboxStanding = (readings: TimeboxReadings): TimeboxStanding => {
  if (!comparable(readings.today)) return 'none';
  const start = comparable(readings.start) ? readings.start : '';
  const end = comparable(readings.end) ? readings.end : '';
  if (start === '' && end === '') return 'none';
  if (end !== '' && readings.today > end) return 'late';
  if (start !== '' && readings.today < start) return 'upcoming';
  return 'running';
};

/**
 * How many days past its end a sprint is.
 *
 * Reported beside {@link timeboxStanding} so a card can say *how* late rather
 * than only *that* it is late — one day over and three weeks over are the same
 * word and very different facts.
 *
 * @param readings - the sprint's dates and today.
 * @returns whole days since the end, or 0 when the sprint is not late.
 */
export const daysLate = (readings: TimeboxReadings): number => {
  if (timeboxStanding(readings) !== 'late') return 0;
  const end = Date.parse(`${readings.end}T00:00:00Z`);
  const today = Date.parse(`${readings.today}T00:00:00Z`);
  return Math.round((today - end) / 86_400_000);
};

/**
 * The timebox as a card prints it.
 *
 * **THE VIEW STATE IS DECIDED HERE, NOT IN `.tsx`.** CLAUDE.md: *"a view state
 * that cannot be asserted without a browser is a domain property that has not
 * been extracted yet."* So the card renders this string and chooses only its
 * colour from {@link timeboxStanding}.
 *
 * An open-ended range prints the half it has — `2026-08-18 → …` — because the
 * arrow is what says the missing side is unknown rather than absent.
 *
 * @param readings - the sprint's dates and today.
 * @returns the label, or `''` where the sprint named no usable date.
 */
export const timeboxLabel = (readings: TimeboxReadings): string => {
  const standing = timeboxStanding(readings);
  if (standing === 'none') return '';
  const start = comparable(readings.start) ? readings.start : '';
  const end = comparable(readings.end) ? readings.end : '';
  const range = start !== '' && end !== '' ? `${start} → ${end}` : start !== '' ? `${start} → …` : `… → ${end}`;
  if (standing !== 'late') return range;
  const over = daysLate(readings);
  return `${range} · ${over} ${over === 1 ? 'day' : 'days'} late`;
};
