import type { PlanSource } from '../../contract/schema.js';

/**
 * WHERE THE CARDS ABOVE CAME FROM — the board's plan estate, named and dated.
 *
 * The board reads plans from a git ref rather than from its own checkout,
 * because a checkout is only as current as someone's last `git pull`: the
 * board's drifted 16 commits in about an hour on 2026-08-27. This line says
 * which ref that was and how old the reading is.
 *
 * IT EXISTS BECAUSE ITS ABSENCE WAS THE BUG'S SECOND HALF. Two operator reports
 * that day — a `2 rounds` badge beside phase Development, and a Deliver button
 * refusing a plan whose every wave had merged — were both this one cause, and
 * neither renderer was wrong: each behaved correctly on a plan parsed from an
 * old file. Nothing on screen said the estate had been read from a commit
 * sixteen behind, so two symptoms twenty minutes apart read as two unrelated
 * defects. An operator meeting the new failure modes below should be able to
 * SEE the mechanism instead of having to know it exists.
 *
 * ALWAYS TRUE, SO NEVER A STATUS PANEL. `StatusPanel`'s contract is to vanish
 * when there is nothing wrong; a line that is true on every board cannot live
 * in it. Same split, and the same reasoning, as the Agents tab's
 * `… · scanned 4s ago · PR data 16s ago` footer — statuses at the top, ages at
 * the foot where the eye lands after the rows.
 */
export function PlanSourceLine({
  planSource,
  ageSeconds,
}: {
  /**
   * Where the plans came from — or UNDEFINED, from a server that predates the
   * field.
   *
   * Optional at RUNTIME, not merely in the schema, and the distinction is the
   * one this whole branch is about: `BoardSchema` gives this field a default,
   * but the client CASTS the payload rather than parsing it, so that default
   * never executes and the property is genuinely absent. A component that
   * dereferenced it would crash the entire page — header, columns and all — on
   * exactly the payload an older server sends.
   */
  planSource: PlanSource | undefined;
  /**
   * How old the read is, from the fleet pulse — the scan and this read see the
   * same refs, and the scan is what fetches them, so its age dates this too.
   *
   * Null where no scan has landed: the age is then OMITTED rather than printed
   * as 0, which would claim a freshness nothing measured. `readRef`'s own rule.
   */
  ageSeconds: number | null;
}) {
  // A ref that could not be resolved is the one case with no provenance to
  // state, and it must NOT be answered by quietly falling back to the checkout
  // — that substitution is the original defect. So the line says what failed.
  //
  // Not styled as an error: a repo with no remote is a legitimate place to run
  // `pnpm board`, and this is the honest report of what such a board can see,
  // not a fault. Amber rather than rose for the same reason the Agents tab
  // reserves rose for a dead server.
  // Nothing to report, and NOT an error: a payload with no `planSource` is an
  // older server's, and the honest answer is silence rather than a line
  // claiming a provenance nobody stated.
  if (!planSource) return null;
  if (!planSource.resolved) {
    return (
      <p
        className="mt-3 px-1 text-xs text-amber-700 dark:text-amber-500"
        data-plan-source="unresolved"
      >
        Plans could not be read from{' '}
        <code className="font-mono">{planSource.ref || 'the default branch'}</code> — this board
        shows only what is in its own working tree, which nobody else can see.
      </p>
    );
  }
  return (
    <p className="mt-3 px-1 text-xs text-slate-400 dark:text-slate-600" data-plan-source="ref">
      Plans read from <code className="font-mono">{planSource.ref}</code>
      {ageSeconds !== null && ` · ${ageSeconds}s ago`}
      {/* The count, not a flag: one unpushed plan and a checkout the ref knows
          nothing about are different situations, and the number is what tells
          them apart. Silent at zero — the dedicated deployment's normal state,
          where saying "0 not pushed" would be noise on every board. */}
      {planSource.localOnly > 0 &&
        ` · ${planSource.localOnly} not pushed`}
      {/* HOW FAR THIS CHECKOUT HAS DRIFTED, and silent unless it has.

          Three states, two of which say nothing. `behind > 0` is the drift
          itself. `behind === 0` is a current checkout and renders NOTHING —
          item 2, and the same rule as `not pushed` above: an indicator that is
          almost always green teaches a reader to stop reading it, which is how
          the next 16-commit drift goes unnoticed. `behind === null` is *cannot
          say* — a detached HEAD or an unresolved ref, where reporting 0 would
          invent an answer nobody measured.

          Amber, not rose, and beside the ref rather than in `StatusPanel`: a
          behind checkout is a fact about this board's provenance, not a fault
          in the run. It cannot make the cards above wrong — they were read from
          the ref — so it explains a surprise rather than announcing a failure. */}
      {planSource.behind !== null && planSource.behind > 0 && (
        <span className="text-amber-700 dark:text-amber-500" data-checkout-behind={planSource.behind}>
          {' · '}checkout {planSource.behind} behind
        </span>
      )}
    </p>
  );
}
