/**
 * How long one generation of the budget record lives before a rotation is due,
 * in milliseconds: 24 hours.
 *
 * Mirrors `BUDGET_GENERATION_MS` in `plot-budget.sh`. It is 24 times the
 * longest spend window, so no line inside a live window sits in the generation
 * a rotation discards.
 */
export const GENERATION_MS = 24 * 60 * 60 * 1000;

/** The 0-based field of a record line that holds its timestamp. */
const AT_FIELD = 4;

/**
 * Decides whether the current generation of the budget record is due for a
 * rotation.
 *
 * A declared duplicate of `budget_rotation_due` in `plot-budget.sh`, held to it
 * by `corpus/budget-rotation.corpus.test.ts`. The rule reads the fifth
 * tab-separated field of the generation's first line, whatever the line's
 * format marker, and a rotation is due where that timestamp is at least
 * {@link GENERATION_MS} older than `now`. A missing generation, a missing first
 * line and a field that is not a decimal integer are never due.
 *
 * @param firstLine - the first line of `budget.tsv` without its newline, or
 *   null where the file is missing or empty.
 * @param now - the clock, epoch milliseconds.
 * @returns true where a rotation is due.
 */
export const rotationDue = (firstLine: string | null, now: number): boolean => {
  if (firstLine === null) return false;
  const at = firstLine.split('\t')[AT_FIELD] ?? '';
  if (!/^[0-9]+$/.test(at)) return false;
  return now - Number(at) >= GENERATION_MS;
};
