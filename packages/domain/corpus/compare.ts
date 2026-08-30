/**
 * The comparison the corpus tier is: one reading against another, reported as
 * a list of named disagreements rather than as a boolean.
 *
 * WHY A LIST AND NOT AN ASSERTION PER FIELD. A disagreement here stops the
 * branch — the worker writes `PLOT-BLOCKED` naming the field, the plan and both
 * readings, and a person decides which side is wrong. That report only exists
 * if the failure carries it, and a `toEqual` per field over 172 plans fails on
 * the first one and names neither how many others disagree nor whether they
 * share a cause. One disagreement in one plan and the same disagreement in all
 * 172 are different findings pointing at different bugs.
 *
 * The same reasoning the Reading slice already applied to phases: it replaced a
 * loop of `toContain` with one empty-array comparison, because the loop
 * "reported 'expected [...8 values] to contain weird' and named neither the plan
 * nor how many were wrong".
 */

/** One field on which the adapter and production disagree. */
export interface Disagreement {
  /** What was being read — a plan's path, or a branch's name. */
  subject: string;
  /** The field's name on the port, and on the wire where they differ. */
  field: string;
  /** What the adapter reported. */
  adapter: string;
  /** What production reported. */
  production: string;
}

/**
 * Renders a disagreement as one line naming the field, the subject and both
 * readings — the three things `PLOT-BLOCKED` has to carry.
 *
 * @param one - the disagreement to render.
 * @returns a single line, safe to read in CI output.
 */
export const describeDisagreement = (one: Disagreement): string =>
  `${one.subject} :: ${one.field} :: adapter=${one.adapter} production=${one.production}`;

/**
 * Compares one field of one subject, appending a disagreement when they differ.
 *
 * Compared through `JSON.stringify` so arrays and objects compare by value and
 * the report prints what differed. `undefined` and an absent key render alike,
 * which is correct here: the port's contract is that an absent wire field reads
 * as its empty value, so a caller cannot tell them apart either.
 *
 * @param into - the list to append to.
 * @param subject - what is being read.
 * @param field - the field's name, as the report should print it.
 * @param adapter - the adapter's reading.
 * @param production - production's reading.
 */
export const compareField = (
  into: Disagreement[],
  subject: string,
  field: string,
  adapter: unknown,
  production: unknown,
): void => {
  const left = JSON.stringify(adapter) ?? 'undefined';
  const right = JSON.stringify(production) ?? 'undefined';
  if (left !== right) into.push({ subject, field, adapter: left, production: right });
};
