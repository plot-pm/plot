import {
  type AgentRow,
  type WaitingGroup,
  type Wave,
} from '../../../contract/schema.js';
import { type WaveGroup, groupByWave } from './waves.js';
import { isStartable, isUnbegun } from './row-identity.js';

/**
 * Groups in fixed order, each labelled by what it asks OF YOU rather than by
 * what the branch is. "wip" is a git fact; "nothing to do but look" is the
 * answer a person came here for.
 *
 * Every group renders even when empty. A group that vanishes is
 * indistinguishable from a group that is empty — and for `waiting-on-machine`,
 * which needs PR data this step does not have, silence would read as "nothing
 * is waiting on CI": a claim this step cannot make.
 *
 * Actionable before diagnostic: `not-started` precedes `quiet`, because work a
 * person can pick up right now outranks work they must go investigate. This
 * order must stay identical to `GROUP_ORDER` in `fleet.ts`, which sorts the
 * rows — a disagreement between the two would sort rows into a sequence the
 * sections then render in a different one.
 */
export const GROUPS: { key: WaitingGroup; icon: string; label: string; hint: string }[] = [
  { key: 'waiting-on-you', icon: '⚠', label: 'Waiting on you', hint: 'review, merge, decide' },
  { key: 'working', icon: '🤖', label: 'Working', hint: 'nothing to do — just look' },
  // *a machine is working* rather than *CI will finish*. The section lists
  // PROCESSES and CI is only one kind: a worker running in a local worktree is a
  // machine working too, and it is observable in this very checkout. The old
  // hint named the one source the section was filled from and would now be
  // wrong about an empty section for the other reason — no local run either.
  //
  // It also drops a FORECAST. *CI will finish* predicts an outcome nothing here
  // measures; *a machine is working* is what was observed, and the section's own
  // rule. `HOST_CANNOT_REPORT_HINT` still withdraws even this where the host
  // cannot be asked at all.
  { key: 'waiting-on-machine', icon: '⏳', label: 'Waiting on a machine', hint: 'nothing — a machine is working' },
  // *approved* rather than only *nobody has taken it*: the section is filtered
  // on the plan's phase first, so every row in it is one an agent may actually
  // take. The old hint described the branch and let three unclaimable kinds of
  // row in behind it.
  { key: 'not-started', icon: '📋', label: 'Not started', hint: 'approved — nobody has taken it' },
  { key: 'quiet', icon: '💤', label: 'Quiet', hint: 'still thinking, or dead?' },
  // `delivered` for the same reason the row's status word changed: it is Plot's
  // term for the transition (Draft → Approved → **Delivered** → Released) and
  // `/plot-deliver` performs it. `merged` names what git did to a ref.
  { key: 'done', icon: '✅', label: 'Done', hint: 'delivered' },
];

/**
 * The one section a WAVE belongs in — a function of the wave, never of a single
 * branch.
 *
 * ## Why this exists
 *
 * A row carries `group`, and `group` is the section `classify` gave THAT BRANCH.
 * When a wave's branches disagree on `state` — one merged, one open — they carry
 * different `group`s, and filtering the fleet by `r.group === key` puts the wave
 * in two sections at once. That is `every-section-has-one-subject / Inverted`,
 * and the domain model names the cause: *"the verdict already aggregates every
 * branch; reading one branch's state is what places the wave twice"*.
 *
 * ## The rule, settled by the plan
 *
 * **A wave is where its UNFINISHED work is.** A wave with any unmerged branch is
 * not done, whatever its merged branches say. So:
 *
 * The defect is NARROW, and so is this. The only split it resolves is `Inverted`:
 * a wave whose SCAN VERDICT says it is not finished (`eligible` or `blocked`),
 * yet which holds at least one merged branch AND at least one genuinely-
 * unfinished one (open · wip · claimed). The verdict is the wave-level truth the
 * merged branch's `state` contradicts — the scan aggregated every branch and
 * still called the wave unfinished, so the merged branch is a slice of an
 * unfinished wave, not a finished one. The wave is where its unfinished work is,
 * so that merged branch moves to the unfinished branch's section.
 *
 * THE VERDICT IS THE GATE, and it has to be. Two shapes look mixed but are not
 * the defect:
 *
 * - a wave with NO verdict (`null` — a pre-verdict pulse, or a synthetic row).
 *   The scan said nothing to aggregate on, and inventing a placement from branch
 *   states is the very guess this function exists to remove. Leave it.
 * - a wave whose branches merely sit in different sections for some OTHER reason
 *   — a build running on the machine, a PR failing review, all of them unmerged.
 *   The board means to show a build in WAITING ON A MACHINE and a reviewable PR
 *   in WAITING ON YOU; the domain model marks those sections as holding processes
 *   and builds, not waves. There is no merged branch to have split it, so the
 *   merged+unfinished guard already excludes it — measured on the mock,
 *   `Modelled`'s build was dragged off the machine section under a rule that
 *   omitted this, which is why the guard is here.
 *
 * A `complete` verdict never reaches the relocation: a complete wave has every
 * non-deferred branch merged, so it has no genuinely-unfinished branch and the
 * guard returns null (its rows already share DONE, subject to phase). Returning
 * null means *leave these rows where they are*. When it does fire, it reads the
 * section off an existing branch's `group` — never re-classifying — so no second
 * answer can drift from the scan's.
 *
 * Exported for test — the mixed wave is the case an implementation that reads
 * branch state gets wrong while passing every uniform-wave assertion.
 */
export function waveSection(rows: AgentRow[]): WaitingGroup | null {
  // The scan's verdict for the wave — every branch carries the same one, so the
  // first non-null answers. No verdict, or `complete`, is not the `Inverted`
  // defect: don't relocate.
  const verdict = rows.find((r) => r.verdict !== null)?.verdict ?? null;
  if (verdict !== 'eligible' && verdict !== 'blocked') return null;
  const merged = rows.find((r) => r.state === 'merged');
  const unfinished = rows.find(
    (r) => r.state === 'open' || r.state === 'wip' || r.state === 'claimed',
  );
  // Both present under a not-finished verdict: the `Inverted` split. The wave is
  // where its unfinished work is, so the merged branch joins the unfinished
  // branch's section — never the reverse. A deferred branch is exempt from the
  // merge gate, so {merged, deferred} is not a split.
  if (merged && unfinished) return unfinished.group;
  return null;
}

/**
 * A wave's identity as a Map key — plan plus name, the pair `openWaves` keys on
 * and the pair the domain model calls a wave's id. The `\0` separator cannot
 * appear in either half, so the join is unambiguous. Module-level and exported
 * so the re-sectioning here and the fold state in the component form one
 * spelling of the identity — two would let a wave move sections here but keep
 * its old fold key there.
 */
export function waveKeyOf(plan: string, wave: string): string {
  return `${plan}\0${wave}`;
}

/**
 * The fleet's rows re-sectioned so every wave lands in exactly ONE section.
 *
 * The board filters rows into sections by `r.group`. This rewrites `group` on
 * every row of a wave that `waveSection` says has a split to resolve, so
 * `Inverted`'s merged and open branches move together instead of splitting. A
 * wave with no split (`waveSection` returns null) is untouched — its rows keep
 * their own groups, which is what leaves a running build on the machine section.
 *
 * Keyed on `(plan, wave)` because a wave's identity is that pair and names
 * repeat across plans. A planless or wave-less row (`wave === ''`) is its own
 * subject and keeps its group: it is a PR-map row, not a wave.
 *
 * Returns a new array with new row objects where a group changed; the input is
 * not mutated, because the fleet is cast from the payload and shared.
 */
export function rowsBySection(rows: AgentRow[]): AgentRow[] {
  const byWave = new Map<string, AgentRow[]>();
  for (const r of rows) {
    if (r.wave === '') continue;
    const key = waveKeyOf(r.plan, r.wave);
    const list = byWave.get(key);
    if (list) list.push(r);
    else byWave.set(key, [r]);
  }
  const sectionOf = new Map<string, WaitingGroup>();
  for (const [key, waveRows] of byWave) {
    const section = waveSection(waveRows);
    if (section !== null) sectionOf.set(key, section);
  }
  return rows.map((r) => {
    if (r.wave === '') return r;
    const section = sectionOf.get(waveKeyOf(r.plan, r.wave));
    return section === undefined || section === r.group ? r : { ...r, group: section };
  });
}

/** One plan's rows within a waiting-group, in the order they arrived. */
export interface PlanGroup {
  plan: string;
  planFile: string;
  rows: AgentRow[];
}

/**
 * Split one waiting-group's rows by plan.
 *
 * By PLAN, not by story: the waiting-groups answer *what needs me next*, and
 * within that the useful unit is the plan — the thing whose waves are being
 * worked. A story spans weeks and several plans; it is the board's axis, not
 * this view's. (It is also not on a fleet row at all.)
 *
 * Rows arrive age-sorted, so a plan's rows keep that order by construction and
 * the PLANS are ordered by their most urgent row — otherwise a plan holding one
 * stale branch would outrank one whose branch just moved. An unknown age sorts
 * last: "we do not know" is not "ancient". **Plans of EQUAL age order by name**,
 * because age alone leaves most pairs tied and the tie was being settled by an
 * arrival order that changes every pulse — see the comparator.
 *
 * Exported for test, and because the count is what decides whether a
 * sub-heading earns its place — a group with one plan gets none.
 */
export function groupByPlan(rows: AgentRow[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const row of rows) {
    const existing = groups.get(row.plan);
    if (existing) existing.rows.push(row);
    else groups.set(row.plan, { plan: row.plan, planFile: row.planFile, rows: [row] });
  }
  const urgency = (g: PlanGroup) => Math.max(...g.rows.map((r) => r.ageMinutes ?? -1));
  return [...groups.values()].sort((a, b) => {
    const byUrgency = urgency(b) - urgency(a);
    if (byUrgency !== 0) return byUrgency;
    // TIES ARE BROKEN BY NAME — the tiebreak #267 landed for NOT STARTED,
    // applied here where the same defect had been sitting unexamined.
    //
    // Age is a COARSE key. The rows of one pulse routinely share an age, so
    // those comparisons return 0 and the surviving order is whatever this Map's
    // insertion order happened to be. `Array.prototype.sort` is stable in every
    // engine since ES2019, so it faithfully preserves that arrival order — and
    // the arrival order is rebuilt from a fresh scan every four seconds.
    // Stability preserves an input that is not itself stable, which is why this
    // reads as a sorting bug and is not one.
    //
    // The plan NAME is the right tiebreak because it is the only field here
    // that cannot change between pulses: an age moves by the minute and a row
    // count moves as branches land, and both are derived. A name is identity.
    //
    // NOT the same line as `sortByWaiting`, and deliberately not shared with it.
    // That comparator keys on `waitingDays` — the plan's approval clock — to
    // answer *which plan has been ignored longest* for a section whose rows are
    // not branches. This one keys on the branch tip's clock to answer *which
    // plan holds the most urgent row*. Two questions, two keys; only the
    // tiebreak behind them is the same, and it is three lines.
    //
    // Found because the flicker was fixed one section over and the identical
    // line sat four hundred lines away in this file, unexamined — nobody had
    // watched THIS section reshuffle. A fix is not finished when the reported
    // instance stops.
    return a.plan.localeCompare(b.plan);
  });
}

/**
 * The waves worth grouping in a section — and there are none outside WAITING ON
 * YOU.
 *
 * A wave earns a row here when it holds **more than one reviewable branch**: a
 * lone PR is a PR, because there is no set for a wave row to name and a heading
 * over one row saves nothing. That is `showsWaveFold`'s rule, and the same one
 * that makes a single-branch wave exactly one row in NOT STARTED.
 *
 * SCOPED TO ONE SECTION on purpose. WORKING holds agents, WAITING ON A MACHINE
 * holds builds, and in neither is *a wave* the thing being decided — the grammar
 * `every-section-has-one-subject` settles that. Here the question is *what needs
 * a decision*, and three PRs from one wave are one decision about that wave.
 *
 * Unnamed waves are skipped: a group headed `(unnamed)` over rows that each name
 * their branch is a label that labels nothing, the same reason
 * `showPlanHeading` refuses a nameless plan.
 */
export function waveGroupsFor(
  rows: AgentRow[],
  section: WaitingGroup,
  waves?: Wave[],
): WaveGroup[] {
  // WHICH ROWS a wave may claim, per section. This is now a LOOKUP against the
  // server-derived wave, not a per-section computation — `the-sections-ask-the-wave`.
  //
  // The wave carries the ONE answer to *which section does this wave belong in*
  // (`Wave.section`, derived once in `deriveWaves` from completeness). The four
  // grouping sections used to re-derive that answer from a row's `state`, and
  // three of them spelled the identical predicate `r.state !== 'merged'` while
  // DONE spelled its inverse. That IS the derivation this plan removes: a wave
  // the server calls done but holding a not-yet-merged row, or a not-started
  // wave with one stray merged branch (`Inverted`), placed the row by its own
  // state and disagreed with the wave.
  //
  //   DONE   claims a wave the server placed in DONE  — `Wave.section === 'done'`.
  //   others claim a wave the server placed elsewhere — `Wave.section !== 'done'`.
  //
  // The REAL DISTINCTION that survives is done-vs-not-done, and it is the wave's
  // to answer. QUIET's *stalled* and WAITING ON YOU's *reviewable* are per-BRANCH
  // facts (`row.group`, from `classify`) that already sectioned these rows before
  // this function ran — `rowsBySection` routed the whole wave to one section, so
  // by here a section's rows are its rows and the only question left is whether
  // the wave they form is finished.
  //
  // WORKING and WAITING ON A MACHINE are absent on purpose: an agent works and a
  // build runs, and neither is a wave — the grammar `every-section-has-one-subject`
  // settles it, and a wave row in either would claim a subject that section does
  // not have.
  if (section === 'working' || section === 'waiting-on-machine') return [];
  // THE CAST GUARD. The client CASTS the fleet payload (`board as Board`), so a
  // Zod `.default([])` never fires and `fleet.waves` is `undefined` on a pulse
  // from a server predating #349 — not `[]`. An absent wave list, or a wave a
  // partial pulse has not carried yet, falls back to the row's own state: the
  // exact behaviour this replaces, so a pre-wave board renders as it did before
  // rather than dropping every wave. Guarded, per `FLEET_CONTROLS_DEFAULT`.
  const wantsDone = section === 'done';
  const sectionOf = new Map<string, WaitingGroup>();
  for (const w of waves ?? []) sectionOf.set(waveKeyOf(w.plan, w.name), w.section);
  const claims = (r: AgentRow): boolean => {
    const waveSection = sectionOf.get(waveKeyOf(r.plan, r.wave));
    // The wave answered: keep the row iff the wave's section matches what THIS
    // section wants (DONE ⇔ the wave is done).
    if (waveSection !== undefined) return (waveSection === 'done') === wantsDone;
    // No wave to ask — the fallback, byte-for-byte the old predicate.
    return wantsDone ? r.state === 'merged' : r.state !== 'merged';
  };
  // NO `length > 1` THRESHOLD, and its removal is the correction that matters.
  //
  // It was there on `showsWaveFold`'s reasoning — *a heading over one row saves
  // no repetition* — and that argument answers a different question. A fold is
  // about SAVING REPETITION; a kind is about **what the row is ABOUT**. A branch
  // cut for the wave `Surfaced` is that wave's work whether the wave holds one
  // branch or five, and the count is a fact about how the plan was written.
  //
  // Measured on the live board, the threshold also never fired: all **12** waves
  // in WAITING ON YOU hold exactly one branch, so the grouping was reachable
  // only through the mock's hand-made two-branch wave. A rule that fires only in
  // a fixture is a rule nothing tests.
  //
  // A wave holding several still folds — `expanded` is what the WaveRow does with
  // a set. What changed is that a wave of one is a wave, not a PR.
  // AN UNNAMED WAVE IS STILL A WAVE, and it still groups. This filtered
  // `(unnamed)` out until 2026-08-21, which left its rows ungrouped — so the plan
  // holding them got no `PlanRow` head and the branch led the row on its own,
  // beside 51 plan-headed siblings. Reported from a screenshot of DONE.
  //
  // Same correction as `carriesWave` on the server: the wave's NAME is not the
  // test for a wave. `MANIFESTO.md` — *"a plan with no subheadings is one wave"*
  // — so a plan nobody cut has one wave, unnamed, and its branches are that
  // wave's work. What it lacks is a label, and `waveLabel` still withholds that:
  // printing `(unnamed)` beside a branch names nothing.
  return groupByWave(rows.filter(claims)).filter((wg) => wg.wave);
}

/**
 * The rows a section renders on their own — everything no wave group claimed.
 *
 * The complement of `waveGroupsFor` over the same input, so every row appears
 * exactly once: a row inside a grouped wave renders in that wave's fold, and
 * everything else renders as itself. Computed as a SET of the claimed rows
 * rather than by re-deriving the predicate, because two spellings of *which rows
 * are grouped* is how a row ends up rendered twice or not at all.
 */
export function ungroupedRows(rows: AgentRow[], section: WaitingGroup, waves?: Wave[]): AgentRow[] {
  const claimed = new Set(waveGroupsFor(rows, section, waves).flatMap((wg) => wg.rows));
  return rows.filter((r) => !claimed.has(r));
}

/**
 * Does a plan sub-heading earn its place ON THIS GROUP?
 *
 * A heading pays for itself by SAVING REPETITION: with two or more rows under
 * one plan, the name prints once above them instead of once on each. With a
 * single row it saves nothing — the name appears exactly once either way, and
 * the heading costs an extra line of height to say it. A section of one-row
 * plans became a stack of alternating headings and rows, each heading labelling
 * the single line beneath it.
 *
 * A nameless group can never have one: there is nothing to head it WITH, and
 * rendering the heading anyway printed a bare "(3)".
 *
 * This replaces a section-wide `showPlanHeadings(rowCount, planCount)` that
 * asked *should this section have headings at all* — `planCount > 1 ||
 * rowCount > planCount`. Both of its clauses are subsumed here: the second IS
 * this rule, counted per group instead of summed across the section, and the
 * first (two plans, one row each) turns out to be a case where headings are
 * *not* wanted. What that clause was really protecting is that unlabelled rows
 * must still name their plan — which is now the row's job whenever its group
 * has no heading, rather than something a section-wide flag guarantees.
 *
 * Exported so the mixed section — one plan with several rows beside a plan with
 * one — can be pinned without a browser. That case is what a section-wide
 * answer cannot express, and it is where the row-side half must hold.
 */
export function showPlanHeading(group: PlanGroup): boolean {
  return Boolean(group.plan) && group.rows.length > 1;
}

/**
 * How long this PLAN has been waiting, in days — the clock that ticks in NOT
 * STARTED, read off the group's own rows.
 *
 * `waitingDays` dates the plan's `Approved:` record, so every row of one plan
 * carries the same number and any of them answers for the group. `Math.max`
 * rather than "the first one" only because a group can hold a deferred branch
 * beside unstarted ones and nothing forces the field onto both — taking the
 * largest keeps a recorded date from being lost behind a null.
 *
 * Null where NO row carries a date. Absent, not zero: `waitingLabel(0)` renders
 * `today`, which would claim a plan was approved this morning on the strength of
 * a field nobody filled in.
 *
 * Exported for test — the null case is the one an implementation reaching for
 * `?? 0` gets wrong while looking right on every dated plan.
 */
export function planWaitingDays(group: PlanGroup): number | null {
  const dated = group.rows.map((r) => r.waitingDays).filter((d): d is number => d !== null);
  return dated.length === 0 ? null : Math.max(...dated);
}

/**
 * Order NOT STARTED's plan groups: **oldest first, by the plan's own clock.**
 *
 * What it replaces, measured at `groupByPlan`: `Math.max(...rows.map((r) =>
 * r.ageMinutes ?? -1))`. In this section `ageMinutes` is `null` on every row —
 * the branches have no tip to date — so every group scored `-1`, the comparator
 * returned 0 for every pair, and the sort did nothing at all.
 * `plot-sprint-support`, approved 187 days ago, sat wherever the map's insertion
 * order happened to put it, beside a plan from that afternoon.
 *
 * **Oldest first, and the direction is the decision.** Sorting startable-first
 * reads as more actionable and buys less: the startable plans are already marked
 * by their own note, and burying a six-month-old plan under a fresh one hides
 * exactly the drift this section exists to surface.
 *
 * This is the GROUP order, and it is deliberately not the same question as
 * `compareWithinGroup` in `fleet.ts`, which orders the ROWS inside a group
 * newest-first on the reasoning that six months of availability is evidence
 * nobody wants a *branch*. That answers *which branch do I pick up*; this
 * answers *which plan has been ignored longest*, which is the question a reader
 * scanning section headings is asking. Two levels, two questions — and the
 * server's row order survives untouched inside each fold.
 *
 * An undated plan sorts LAST. It has no recorded approval, so it has no claim on
 * a position that means *this has been waiting*; `-1` would put it above a plan
 * approved today and assert a wait nobody measured.
 *
 * Exported for test: the old comparator scores every group here `-1`, so an
 * assertion that merely checks the groups came back in some order passes against
 * a sort that does nothing.
 */
export function sortByWaiting(groups: PlanGroup[]): PlanGroup[] {
  return [...groups].sort((a, b) => {
    const byWaiting = (planWaitingDays(b) ?? -1) - (planWaitingDays(a) ?? -1);
    if (byWaiting !== 0) return byWaiting;
    // TIES ARE BROKEN BY NAME, and that is what makes the list readable.
    //
    // Waiting days is a COARSE key: most plans in this section were approved on
    // the same day, so most comparisons return 0 and the surviving order is
    // whatever `groups` happened to arrive in. `Array.prototype.sort` is stable
    // in every engine since ES2019, so it faithfully preserves that arrival
    // order — and the arrival order is rebuilt from a fresh scan every four
    // seconds, from a Map whose insertion order follows the pulse. Stability
    // preserves an input that is not itself stable.
    //
    // Observed on the live board 2026-08-20: the NOT STARTED section reordered
    // on almost every pulse, which makes a list of a dozen plans unreadable —
    // the eye re-finds its place from scratch each time, and a row clicked at
    // the moment of a pulse can be a different row than the one aimed at.
    //
    // The plan NAME is the right tiebreak because it is the only field here
    // that cannot change between pulses: `planWaitingDays` moves at midnight,
    // row counts move as branches land, and both are derived. A name is the
    // plan's identity.
    return a.plan.localeCompare(b.plan);
  });
}

/**
 * What the plan row says about its waves — the COUNT read from the server's
 * `Wave` list, and *first eligible* from the group's own rows.
 *
 * **THE HEAD ASKS THE WAVE.** `the-contract-carries-a-wave` put a server-derived
 * `Wave` on the payload: one entry per `(plan, wave)`, carrying the ONE section
 * the server placed it in. The count is a fact about the plan's waves, and the
 * server already knows how many of them are unstarted — so this reads
 * `fleet.waves` rather than re-grouping the rows in front of it with
 * `groupByWave`, which was a second answer to a question the server answers.
 * That re-grouping was the derivation `the-wave-is-a-thing-the-board-can-hold`
 * exists to remove: a wave whose branches span sections could be counted
 * differently here than the server counted it in DONE.
 *
 * Counted over the waves the server placed in `not-started` FOR THIS PLAN. A
 * merged wave the server put in DONE is not counted here even if one of its rows
 * lingers under the plan head; a blocked wave IS counted — it is unstarted work
 * waiting on an earlier wave, which the row filter (`isUnbegun`, `open` only)
 * would have dropped.
 *
 * Counted over the UNBEGUN rows only. A deferred branch keeps a row of its own
 * beneath the plan, with its own PR and age, so counting it into "3 waves" would
 * describe it twice and in the wrong terms — it is not a wave nobody has
 * reached, it is a branch somebody set down.
 *
 * **The limit is recorded rather than hidden: this counts what is in THIS
 * SECTION.** A plan whose first wave already merged has that wave in DONE, so it
 * reports the remainder — two where the plan file lists three. That is the
 * honest number for the question the section asks (*what is not started*), and a
 * reader wanting the full arc has the plan link on the row.
 *
 * `first eligible` stays a ROW fact, from `isStartable` — the same predicate the
 * row menu uses to decide whether `Start work` is offered, so the summary cannot
 * promise an action the menu then refuses. The wave carries a `verdict`, but
 * startability is a per-branch question the menu owns (a wave can be eligible
 * while a particular branch in it is not the one to start), so it is read where
 * the menu reads it.
 *
 * `waves` ABSENT falls back to the row derivation. The board CASTS the payload
 * (`board as Board`) rather than parsing it, so `fleet.waves` is `undefined` —
 * not `[]` — on a pulse from a pre-wave server (`FLEET_CONTROLS_DEFAULT`,
 * 2026-08-22). The fallback keeps such a server working; a live server emits
 * `waves` unconditionally, so the fallback is the safety net and not the path.
 *
 * Empty string where there is nothing to summarise, so the caller renders
 * nothing rather than a bare count of zero.
 *
 * Exported for test — the section-scoped count is the half that reads like a bug
 * until it is stated.
 */
export function waveSummaryFor(group: PlanGroup, waves?: Wave[]): string {
  const unbegun = group.rows.filter(isUnbegun);
  // COUNTED FROM THE SERVER'S WAVES where the payload carries them: the entries
  // the server placed in `not-started` for this plan. `deriveWaves` gives an
  // incomplete wave exactly one home — `not-started` — so this is every wave of
  // the plan that is not yet done, counted once however many branches it holds.
  const count = waves
    ? waves.filter((w) => w.plan === group.plan && w.section === 'not-started').length
    : // FALLBACK for a pre-wave server: count the unbegun rows' waves, the way
      // the head did before the contract carried the wave. `groupByWave`
      // collapses a multi-branch wave to one, which is the reading the count
      // needs.
      groupByWave(unbegun).length;
  if (count === 0) return '';
  const label = `${count} wave${count === 1 ? '' : 's'}`;
  return unbegun.some(isStartable) ? `${label}, first eligible` : label;
}

/**
 * How many of a PLAN's waves belong in a DIFFERENT section from this head's.
 *
 * A plan may legitimately span sections — a wave merged into DONE while a later
 * one waits in NOT STARTED — and the board draws it one head per section, each
 * heading only the waves that section holds. That is right, but until now the
 * omission was SILENT: `waveSummaryFor` counts the waves in THIS section and says
 * nothing of the rest, so the visible half of a three-wave plan reads
 * indistinguishably from a plan that only ever had two. The reader cannot tell a
 * split plan from a whole one, which is the exact confusion
 * `a-split-plan-says-it-is-split` was filed for.
 *
 * READS THE SERVER-DERIVED WAVES, never re-derives them. `deriveWaves` already
 * answered which ONE section each `(plan, wave)` belongs in — the whole point of
 * `the-wave-is-a-thing-the-board-can-hold` — so this counts that answer rather
 * than picking a predicate and disagreeing with it. Before that entity existed
 * the numerator was undefined: a mixed wave was in two sections at once, so
 * *"how many of my waves are not here"* had no single answer. It does now, which
 * is why this branch waited on `a-wave-is-one-row`.
 *
 * JOINED ON `plan`, which is half a wave's identity — wave names repeat across
 * plans, so a namesake wave of another plan must not count as this plan's.
 *
 * GUARDS THE ABSENT PAYLOAD. `fleet.waves` defaults to `[]` at parse time, but
 * the board CASTS the payload rather than parsing it (`board as Board`), so a
 * pre-wave pulse leaves `waves` `undefined` — the `FLEET_CONTROLS_DEFAULT` trap,
 * shipped once already. A missing list is *nothing to report*, which is zero.
 *
 * Exported for test — the namesake and absent-payload cases are the two a naive
 * `waves.length - here` gets wrong while looking right on a single split plan.
 */
export function wavesElsewhere(
  waves: Wave[] | undefined, plan: string, section: WaitingGroup, here?: Set<string>,
): number {
  if (!waves) return 0;
  const mine = waves.filter((w) => w.plan === plan);
  // COUNTED AGAINST THE HEAD'S OWN WAVES where the caller can name them, and
  // against the rendered section only as a fallback.
  //
  // The section comparison alone is wrong, and measurably so. `deriveWaves`
  // gives a wave TWO possible sections — `complete ? 'done' : 'not-started'` —
  // while `classify` places rows across SIX groups, so a row needing attention
  // is GUARANTEED to sit in a section no wave can carry. Measured 2026-08-24:
  // 30 of 80 rows disagreed with their own wave's section (22 of them
  // `waiting-on-you` over a `not-started` wave), and 16 plan heads therefore
  // reported EVERY wave as elsewhere — including one-wave plans announcing that
  // their only wave was somewhere else.
  //
  // The head asks *how many of my waves are NOT here*, and "here" is the set of
  // waves its own rows belong to — a fact the group holds and the rendered key
  // does not. `here` is that set; a wave outside it is genuinely elsewhere
  // whatever section word either side happens to use.
  if (here) return mine.filter((w) => !here.has(w.name)).length;
  return mine.filter((w) => w.section !== section).length;
}

/**
 * The fragment a plan head appends to its wave summary — *1 wave elsewhere* — or
 * the empty string where nothing is elsewhere, so the caller renders nothing
 * rather than a bare *0 elsewhere*.
 *
 * A sibling of `waveSummaryFor`'s own empty-string contract: the count belongs to
 * the plan, and a count of zero is a fact the head has no reason to state.
 */
export function elsewhereNote(count: number): string {
  if (count <= 0) return '';
  return `${count} wave${count === 1 ? '' : 's'} elsewhere`;
}

/**
 * Does this plan row earn an expander?
 *
 * Only where opening it REVEALS something. A plan with one branch beneath it
 * already shows that branch's name in its own summary line, so a control that
 * unfolds a single row the reader can already read is noise — the same rule
 * `showPlanHeading` applies one level up, where a heading over one row saves no
 * repetition.
 *
 * Counted over ALL the group's rows, not just the unbegun ones: a plan with one
 * unstarted wave and one deferred branch has two rows to show, and the deferred
 * one carries a PR and an age that appear nowhere else.
 *
 * Exported for test: the one-wave case is the one an implementation that always
 * renders the expander gets wrong while passing every assertion about folding.
 */
export function showsWaveFold(group: PlanGroup): boolean {
  // COUNTED IN WAVES, not in rows — since NOT STARTED renders one row per WAVE
  // rather than one per branch. A plan whose single wave holds five branches has
  // five rows and ONE child row, so the row count promised a fold that revealed
  // one line; and the wave's own fold is what discloses those five.
  //
  // Measured on the estate: `opus5-longhorizon-hardening :: Implementation`
  // holds five branches, and it is the plan this got wrong.
  return groupByWave(group.rows).length > 1;
}
