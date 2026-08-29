/**
 * The result of asking a port a question.
 *
 * Three outcomes, never two. An operation may answer, may break while being
 * asked, or may be one this source cannot answer at all.
 *
 * @typeParam T - the value an answered call carries.
 */
export type PortResult<T> =
  | { ok: true; value: T }
  | { ok: false; why: 'failed' }
  | { ok: false; why: 'unaskable' };

/**
 * Builds an answered result.
 *
 * An empty value is an answer: `answered([])` reports that the source was asked
 * and holds nothing, which is not the same fact as either failure.
 *
 * @param value - what the source answered with.
 * @returns a result with `ok: true`.
 */
export const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });

/**
 * Builds the result of a call that was asked and broke.
 *
 * @returns a result with `ok: false` and `why: 'failed'`.
 */
export const failed = <T>(): PortResult<T> => ({ ok: false, why: 'failed' });

/**
 * Builds the result of a call this source cannot answer at all.
 *
 * @returns a result with `ok: false` and `why: 'unaskable'`.
 */
export const unaskable = <T>(): PortResult<T> => ({ ok: false, why: 'unaskable' });

/**
 * Narrows a result to its answered form.
 *
 * @param result - the result to test.
 * @returns true when the result carries a value.
 */
export const isAnswered = <T>(result: PortResult<T>): result is { ok: true; value: T } => result.ok;

/**
 * Reads an answered result's value, falling back where the call did not answer.
 *
 * Both failure reasons take the fallback. A caller that needs to tell them
 * apart reads `why` instead — collapsing them is what this type exists to
 * prevent, so this helper is for callers that have already decided the
 * distinction does not affect them.
 *
 * @param result - the result to read.
 * @param fallback - what to return when the call did not answer.
 * @returns the answered value, or the fallback.
 */
export const valueOr = <T>(result: PortResult<T>, fallback: T): T =>
  result.ok ? result.value : fallback;
