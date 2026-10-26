/**
 * Whether a scratch-desk write probe proves the configured `Worker command`
 * can write, and so may a claim be pushed for it.
 *
 * Mirrors `PermissionDenialReading` in {@link ./sample.js}: `yes` and `no` are
 * both observed outcomes, and `unanswerable` is a THIRD thing — the probe
 * itself did not run to a conclusion, which is not evidence either way.
 */
export type WriteProbeReading = 'yes' | 'no' | 'unanswerable';

/**
 * Whether a probe reading permits a claim to be pushed.
 *
 * **ABSENT IS NOT FALSE.** A probe that could not run — no harness on `PATH`,
 * the scratch desk could not be cut, the command timed out — did not observe a
 * refused write, so `unanswerable` proceeds exactly as `yes` does. Only an
 * OBSERVED absence of the touched file after the command exited is `no`, and
 * only `no` refuses.
 *
 * @param reading - what the probe observed.
 * @returns `proceed` to hand over, `refuse` to stop before any claim is pushed.
 */
export const writeProbeAnswer = (reading: WriteProbeReading): 'proceed' | 'refuse' =>
  reading === 'no' ? 'refuse' : 'proceed';

/**
 * The message a refused probe reports, naming the same cause and the same
 * advice as `needsPersonMarker`'s `permission-denied` case in
 * {@link ./ending-action.js} — one fault, one wording, whether it is read after
 * the fact from an ended agent or caught before a claim exists.
 *
 * @param detail - what the probe observed; empty when nothing more was recorded.
 * @returns the refusal text.
 */
export const writeProbeRefusal = (detail: string): string =>
  `The worker command was refused every write it tried (${detail || 'no detail was recorded'}). ` +
  `A dispatched agent would meet the same refusals. Decide: fix the worker command's permissions, then try again.`;
