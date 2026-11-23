/**
 * Which plans the pulse leaves out of its walk: a finished plan, and a
 * Delivered plan whose work is live once it merges.
 *
 * @concept pulse-omits-plan
 */
import { planIsFinished } from './plan-names-branch.js';

/**
 * Whether a plan of `type` is live once its work merges, so that no release
 * records it as Released.
 *
 * @param type - the plan's `Type:` value, as the plan store reads it.
 * @returns `true` for exactly `docs` and `infra`; the comparison folds no case.
 */
export const liveOnMerge = (type: string): boolean => type === 'docs' || type === 'infra';

/**
 * Whether the pulse leaves a plan out of its walk.
 *
 * @param phase - the plan's phase, in any letter case.
 * @param type - the plan's `Type:` value, as the plan store reads it.
 * @returns `true` where the plan is finished (`planIsFinished`), or where the
 *   phase is `delivered` and {@link liveOnMerge} holds for `type`.
 */
export const pulseOmitsPlan = (phase: string, type: string): boolean =>
  planIsFinished(phase) || (phase === 'delivered' && liveOnMerge(type));
