/**
 * Where a plan's index symlink belongs, and what it should point at.
 *
 * `delivered/` means "no longer active", not "phase is exactly Delivered" —
 * releasing a plan moves no symlink, and this rule is asked only on the
 * deliver arm.
 *
 * It is string work: no path it returns need exist, and it reaches no
 * filesystem. The caller reads the target's presence, creates or replaces the
 * symlink, and removes the stale one — this only computes the paths and the
 * relative target a symlink under `delivered/` should carry.
 *
 * @concept index-symlink
 */

/** What the caller needs to place a plan's index link. */
export interface IndexSymlinkReading {
  /** The configured active index directory, such as `docs/plans/active/`. */
  readonly activeDir: string;
  /** The configured delivered index directory, such as `docs/plans/delivered/`. */
  readonly deliveredDir: string;
  /** The plan's slug. */
  readonly slug: string;
  /** The plan file's basename, such as `2026-10-03-a-plan.md`. */
  readonly planBasename: string;
}

/** The two paths the caller must reconcile, and the link's target. */
export interface IndexSymlinkPlacement {
  /** The `active/<slug>.md` path to remove, if present. */
  readonly activeLink: string;
  /** The `delivered/<slug>.md` path to create or confirm. */
  readonly deliveredLink: string;
  /** The relative target the delivered link should point at. */
  readonly target: string;
}

/** Joins a directory and a name, adding exactly one `/` between them. */
const join = (dir: string, name: string): string => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`);

/**
 * Computes the index symlink's placement for a delivered plan.
 *
 * @param reading - the configured index directories, the slug, and the plan's basename.
 * @returns the active link to remove, the delivered link to ensure, and its target.
 */
export const indexSymlinkPlacement = (reading: IndexSymlinkReading): IndexSymlinkPlacement => ({
  activeLink: join(reading.activeDir, `${reading.slug}.md`),
  deliveredLink: join(reading.deliveredDir, `${reading.slug}.md`),
  // `../<basename>`, matching the shell's `ln -sfn "../$plan_basename"` — one
  // level up from `delivered/` to the plan directory shared with `active/`.
  target: `../${reading.planBasename}`,
});
