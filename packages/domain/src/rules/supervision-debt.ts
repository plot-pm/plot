import type { SupervisionCause } from './supervision.js';

/**
 * Whether a supervision cause is a person's to answer.
 *
 * A TOTAL RECORD RATHER THAN A STRING TEST, the shape `HOLD_SCOPE` already uses
 * in `registryd-main.ts`: a tenth cause added to {@link SupervisionCause} fails
 * the build here instead of defaulting into `false`, which is the direction
 * nobody notices.
 *
 * KEPT AT NINE THOUGH ONLY THREE HAVE EVER FIRED. Measured across both registry
 * logs to 2026-09-27: `no-progress` 1200, `no-headroom` 1122, `budget-spent`
 * 498, and zero for the rest. A narrowed type would refuse a cause the
 * supervisor can legitimately produce.
 *
 * `no-progress` IS `false`, AND IT DECIDES MOST ROWS. It is what the fleet
 * restarts on, and `budget-spent` is the transition to a person; at 60% of all
 * emissions this one entry answers the majority of desks. A desk the fleet will
 * retry does not owe anybody anything yet.
 */
export const OWES_A_PERSON: Record<SupervisionCause, boolean> = {
  // The correction budget is exhausted; nothing automatic remains.
  'budget-spent': true,
  // A `PLOT-BLOCKED` marker is a question addressed to a person.
  'agent-blocked': true,
  // An agent the registry cannot read is a broken installation.
  'declaration-absent': true,
  'declaration-unreadable': true,
  // `rules/fleet-size.ts` working; the machine will serve it.
  'no-headroom': false,
  // Nothing is wrong, and it never reaches the report.
  'worker-alive': false,
  // The desk is finishing.
  'gates-passed': false,
  // The tick hands a correction.
  'gates-failed': false,
  // What the fleet restarts on — see above.
  'no-progress': false,
};

/**
 * Whether the desk behind this cause needs a person to look at it.
 *
 * @param cause - the cause the tick reported, or null where it judged no desk.
 * @returns true only where nothing automatic remains; false for null, because
 *   an unjudged desk makes no claim either way.
 */
export const owesAPerson = (cause: SupervisionCause | null): boolean =>
  cause === null ? false : OWES_A_PERSON[cause];

/**
 * What a reader is told about a cause, in the register slot 5 uses.
 *
 * A RENDERING AND NOTHING ELSE, the shape `quietKindWord` sets: the mapping
 * above decides who owes the desk, and this says it in words. It is here rather
 * than in a `.tsx` for the Layering Rule's stated reason — *"a view state that
 * cannot be asserted without a browser is a domain property that has not been
 * extracted yet"* — so the words are asserted in a unit test and a browser test
 * only proves they show.
 *
 * **THE WORDS SAY WHO ACTS, BECAUSE THAT IS THE QUESTION.** `no-headroom` reads
 * *waiting for room* rather than *deferred*: the first tells an operator to do
 * nothing, and the second names a mechanism they must then interpret. The three
 * causes that owe a person read as demands.
 *
 * `no-progress` READS *restarting*, and that is the entry the plan contests and
 * settles. It is what the fleet retries on, so the honest word is what the fleet
 * is doing about it — not *stuck*, which would send a person to a desk the
 * supervisor is already handling. `budget-spent` is the transition to a person
 * and says so.
 *
 * @param cause - the cause the tick reported.
 * @returns the phrase for a reader, in lower case.
 */
export const supervisionCauseWord = (cause: SupervisionCause): string => {
  switch (cause) {
    case 'worker-alive': return 'working';
    case 'gates-passed': return 'finishing';
    case 'gates-failed': return 'being corrected';
    case 'declaration-absent': return 'declaration missing';
    case 'declaration-unreadable': return 'declaration unreadable';
    case 'agent-blocked': return 'blocked, asked you';
    case 'budget-spent': return 'out of attempts';
    case 'no-progress': return 'restarting';
    case 'no-headroom': return 'waiting for room';
  }
};
