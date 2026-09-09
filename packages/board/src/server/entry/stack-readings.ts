import type { CiSignals, StackReadings } from '@plot-pm/domain/rules/stack';

/**
 * The probe report → `StackReadings` mapping, shared by the two entries that
 * judge one.
 *
 * **ITS OWN MODULE BECAUSE AN ENTRY FILE CANNOT BE IMPORTED.** Every `entry/*.ts`
 * ends in a `import.meta.url === pathToFileURL(process.argv[1])` block that runs
 * the file as a program. Bundled, that comparison is true for whichever entry
 * was the entry point — but the IMPORTED module's block is evaluated first and
 * its `import.meta.url` is the bundle's own path, so it matches too. Measured
 * 2026-09-09: `entry/adopt.ts` imported this function from `propose-stack.ts`,
 * and `plot-adopt.mjs` printed a `StackProposal` and exited before its own main
 * block ran. The bundle was correct and the wrong program ran.
 *
 * That is why no entry in this directory imports another, and every one carries
 * its own `readingsFrom`. Where two genuinely need ONE answer, the answer moves
 * here — a module with no main block, which both may import.
 */

/**
 * Read one number from a probe's report.
 *
 * @param value what the field held
 * @param fallback what an absent or unreadable field means
 * @returns the number, or the fallback
 */
const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Read one string from a probe's report.
 *
 * @param value what the field held
 * @returns the string, or `''` where the field was absent or not a string
 */
const stringOr = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Turn a merged probe report into the readings `proposeStack` takes.
 *
 * **AN ABSENT FIELD IS A READING NOBODY TOOK, and it is read that way.** A
 * missing `node_floor` means the repository pins nothing, which the rule
 * answers `null` for rather than assuming a floor; a missing count is zero
 * matches, which proposes nothing. Neither is coerced into the reassuring
 * direction.
 *
 * @param report the merged JSON the two collectors printed
 * @returns the readings, with every absent field read as *nothing was found*
 */
/**
 * Read the CI signals from a probe's report.
 *
 * **AN ABSENT `ci_signals` IS `null`, NEVER `{false, false}`.** The two say
 * different things — *the collector did not look* against *the collector looked
 * and the tree shows nothing* — and only the second licenses writing no `CI:`
 * key on the repository's behalf. `plot-detect-repo.sh` does not report the
 * field yet, so `null` is the answer on this estate today.
 *
 * @param value what the `ci_signals` field held
 * @returns the two signals, or `null` where the field was absent or not an
 *   object
 */
const ciSignalsFrom = (value: unknown): CiSignals | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const signals = value as Record<string, unknown>;
  return {
    jenkinsfile: signals.jenkinsfile === true,
    ghWorkflows: signals.gh_workflows === true,
  };
};

export const readingsFrom = (report: Record<string, unknown>): StackReadings => {
  const styles = (report.commit_style_counts ?? {}) as Record<string, unknown>;
  return {
    nodeVersion: stringOr(report.node),
    nodeFloor:
      typeof report.node_floor === 'number' && Number.isFinite(report.node_floor)
        ? report.node_floor
        : null,
    commitStyleCounts: {
      colon: numberOr(styles.colon, 0),
      dash: numberOr(styles.dash, 0),
      conventional: numberOr(styles.conventional, 0),
    },
    ticketPrefix: stringOr(report.ticket_prefix),
    ticketPrefixCount: numberOr(report.ticket_prefix_count, 0),
    subjectsRead: numberOr(report.subjects_read, 0),
    germanWordCount: numberOr(report.german_words, 0),
    hasHubDoc: stringOr(report.hub_docs) !== '',
    ciSignals: ciSignalsFrom(report.ci_signals),
  };
};
