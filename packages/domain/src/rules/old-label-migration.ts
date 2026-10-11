/**
 * What `--start` and `--stop` do with a supervisor loaded under the old default
 * label `com.plot-pm.registryd`, given which checkout it serves.
 *
 * The caller reads the loaded job once (`plot-fleetctl.sh`'s
 * `supervisor_checkout`) and hands the answer in; this rule does no I/O.
 *
 * - `this`: the old unit serves this checkout, so it is unloaded and its unit
 *   file removed.
 * - `another`: the old unit is another checkout's, so it is left alone.
 * - `unknown`: the loaded job names no working directory, so it may be another
 *   checkout's. It is left loaded and the caller refuses.
 *
 * A caller that finds no old unit loaded asks nothing; this rule has no
 * `none` input.
 *
 * @concept old-label-migration
 */

/** Which checkout a loaded old-label unit serves, as `supervisor_checkout` read it. */
export type OldLabelReading =
  | { readonly kind: 'this'; readonly path: string }
  | { readonly kind: 'another'; readonly path: string }
  | { readonly kind: 'unknown' };

/** What to do with the old-label unit. */
export type OldLabelAction = 'unload-and-remove' | 'leave' | 'refuse';

/**
 * Decides what happens to a loaded old-label unit.
 *
 * @param reading - which checkout the unit serves.
 * @returns `unload-and-remove` for this checkout's unit, `leave` for another
 *   checkout's, `refuse` when the serving checkout cannot be read.
 */
export const oldLabelAction = (reading: OldLabelReading): OldLabelAction => {
  switch (reading.kind) {
    case 'this':
      return 'unload-and-remove';
    case 'another':
      return 'leave';
    case 'unknown':
      return 'refuse';
  }
};
