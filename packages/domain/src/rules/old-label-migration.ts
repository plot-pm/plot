/**
 * What `plot-fleetctl.sh` does with a supervisor loaded under the old default
 * label `com.plot-pm.registryd`, given which checkout it serves and which verb
 * asks.
 *
 * The caller reads the loaded job once (`plot-fleetctl.sh`'s
 * `supervisor_checkout`) and hands the answer in; this rule does no I/O.
 *
 * `retire` is what `--start` and `--stop` ask:
 *
 * - `this`: the old unit serves this checkout, so it is unloaded and its unit
 *   file removed.
 * - `another`: the old unit is another checkout's, so it is left alone.
 * - `unknown`: the loaded job names no working directory, so it may be another
 *   checkout's. It is left loaded and the caller refuses.
 *
 * `status` is what `--status` asks:
 *
 * - `this`: the old unit is this fleet's supervisor, so the status is read from
 *   it and notes the old label.
 * - `another` and `unknown`: the old unit is not shown as this fleet's.
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

/** Which `plot-fleetctl.sh` verb asks: `retire` for `--start` and `--stop`, `status` for `--status`. */
export type OldLabelVerb = 'retire' | 'status';

/** What to do with the old-label unit. `note` is answered to `status` only. */
export type OldLabelAction = 'unload-and-remove' | 'leave' | 'refuse' | 'note';

/**
 * Decides what happens to a loaded old-label unit.
 *
 * @param reading - which checkout the unit serves.
 * @param verb - which verb asks.
 * @returns for `retire`: `unload-and-remove` for this checkout's unit, `leave`
 *   for another checkout's, `refuse` when the serving checkout cannot be read.
 *   For `status`: `note` for this checkout's unit, `leave` otherwise.
 */
export const oldLabelAction = (reading: OldLabelReading, verb: OldLabelVerb): OldLabelAction => {
  if (verb === 'status') return reading.kind === 'this' ? 'note' : 'leave';
  switch (reading.kind) {
    case 'this':
      return 'unload-and-remove';
    case 'another':
      return 'leave';
    case 'unknown':
      return 'refuse';
  }
};
