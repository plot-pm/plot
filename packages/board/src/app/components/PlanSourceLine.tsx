import { checksUnaskableNote, ciDisplayName } from '@plot-pm/domain';
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
 * refusing a plan whose every slice had merged — were both this one cause, and
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
 *
 * IT ALSO CARRIES WHAT THE BOARD COULD NOT ASK — one line, when the host
 * reports no checks for any pull request. Same kind of fact as the ref: what
 * this board could reach, said beneath the cards it reached it for. It is a
 * SEPARATE paragraph rather than a clause on the ref line, because the two are
 * independent — a board with no `planSource` still knows its host answered
 * nothing, and coupling them hid the note on exactly the older payload the ref
 * line is careful about.
 */
export function PlanSourceLine({
  planSource,
  ageSeconds,
  checksUnaskable = false,
  ci = '',
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
  /**
   * Whether the host could not report checks for ANY pull request on this
   * board — `checksUnaskable` over every card's PRs, decided in the domain.
   *
   * ONE UNREACHABLE SERVICE IS NOT SEVENTY-TWO FINDINGS. A per-PR `checks not
   * asked` beside every number means *this pull request*; on a Jenkins team,
   * where the board reaches `gh` alone, it is true of every one of them and
   * says nothing but *this stack*. So it is said HERE, once, beside the other
   * facts about what this board could reach — and the per-PR notes remain,
   * because a reader must still be able to see which rows the claim covers.
   *
   * Optional at runtime for the same reason `planSource` is: the client casts
   * the payload rather than parsing it, so a component must survive its
   * absence.
   */
  checksUnaskable?: boolean;
  /**
   * The CI system the repository declared, named as a reader calls it.
   *
   * NAMES WHICH CI ANSWERED NOTHING. An empty check column cannot otherwise be
   * told from a stack with no CI, and those need opposite actions. Empty falls
   * back to the unnamed sentence — `checksUnaskableNote` owns that choice. The
   * key-to-name mapping is `server-info.ts`'s; the domain names no vendor.
   */
  ci?: string;
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
  // THE CONNECTOR NOTE IS INDEPENDENT OF THE PROVENANCE, and rendering it
  // inside the ref line would couple two facts that have nothing to do with
  // each other: a board that cannot say where its plans came from can still
  // know its host reports no checks, and a board with a perfectly resolved ref
  // can be the Jenkins team this exists for. Measured — the first version put
  // it inside the resolved-ref paragraph, and it vanished on every payload with
  // no `planSource`, which is exactly the older server the line above is
  // careful about.
  //
  // Not amber: a host that carries no check rollup is a legitimate stack rather
  // than a fault in this run, the same reason a repo with no remote is reported
  // and not scolded. The sentence is the domain's, so what this board claims
  // about its own reach is asserted in a unit test rather than written here.
  const ciName = ciDisplayName(ci);
  const checksLine = checksUnaskable ? (
    <p
      className="mt-1 px-1 text-xs text-slate-400 dark:text-slate-600"
      data-checks-unaskable
      data-ci={ciName || undefined}
      title={checksUnaskableNote(ci)}
    >
      {ciName === ''
        ? 'Checks not asked — the host reports none for any pull request here.'
        : `Checks not asked — ${ciName} reports none for any pull request here.`}
    </p>
  ) : null;

  if (!planSource) return checksLine;
  if (!planSource.resolved) {
    return (
      <>
        <p
          className="mt-3 px-1 text-xs text-amber-700 dark:text-amber-500"
          data-plan-source="unresolved"
        >
          Plans could not be read from{' '}
          <code className="font-mono">{planSource.ref || 'the default branch'}</code> — this board
          shows only what is in its own working tree, which nobody else can see.
        </p>
        {checksLine}
      </>
    );
  }
  return (
    <>
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
    {checksLine}
    </>
  );
}
