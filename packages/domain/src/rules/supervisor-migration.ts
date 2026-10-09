/**
 * Whether an old-label supervisor unit may be migrated to the new label.
 *
 * `plot-fleetctl.sh --start` finds a unit still loaded under the retired
 * default label (`com.plot-pm.registryd` / `plot-registryd`). It may only be
 * booted out and replaced when IT SERVES THIS CHECKOUT — a unit naming another
 * checkout's working directory, or naming none at all, is left exactly as it
 * is, because an operator may have a second repository still running under
 * that name.
 *
 * It is string work: both paths arrive already resolved (`pwd -P`, so a
 * symlinked checkout compares equal to its physical path), and the rule
 * reaches no filesystem itself.
 *
 * @concept supervisor-migration
 */

/** What the shell read before asking. */
export interface SupervisorMigrationReading {
  /**
   * The old-label unit's working directory, physically resolved; empty when
   * the label names no working directory (no unit loaded, or one launchd
   * holds with no recorded directory).
   */
  readonly servedPath: string;
  /** This repository's main checkout, physically resolved. */
  readonly repoRoot: string;
}

/**
 * Answers whether the old-label unit may be migrated.
 *
 * An empty `servedPath` never migrates: it is indistinguishable from *another
 * checkout* at this rule's input, and treating it as *this one* would risk
 * tearing down a unit nothing here can identify.
 *
 * @param reading - the old unit's served path and this repository's root.
 * @returns `true` only when both paths are non-empty and equal.
 */
export const supervisorMigrates = (reading: SupervisorMigrationReading): boolean =>
  reading.servedPath !== '' && reading.servedPath === reading.repoRoot;
