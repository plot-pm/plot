## Implementation brief — delivery-chips-and-waiting-on-you (wave: Waiting on you)

- **Plan (canonical):** docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2490 merged
- **Branch:** `bug/waiting-on-you-counts-visible-rows` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

The Chips wave (`bug/delivery-chips-decided-in-the-domain`) is done and merged — PR #2521, squash-merged as "Chips". It touched `chip-row.ts`, `ownership.ts`, `sprint-selection.ts`, `AgentList.tsx`, `DeliveryFilters.tsx`, `chip-readings.ts`. It never touched `waiting-tickets.ts`, `ticket-phase.ts` or `fleet.ts`. Nothing blocks this wave; it waits on nothing from Chips and the Tests-and-text wave waits on this one (it fixes the `unplanned-issues.test.ts` `PLOT_REPO_ROOT` leak and restores a lost sprint-slug test — do that work there, not here).

### What to build

**Half of this slice's stated defect is already fixed — verify that before changing anything.** The plan's Motivation section was written against `84b1638e4` (2026-10-24) and says `waiting-tickets.ts:165-174` counts planned and released rows the inbox never renders. Checking `packages/domain/src/rules/waiting-tickets.ts` as of `84b1638e4` (`git show 84b1638e4:packages/domain/src/rules/waiting-tickets.ts`) against current `main`: the file is **byte-identical**. `allReleased` and `ticketPhase`-based filtering already existed at the measurement commit — `render()` already does `unfinished = selected.filter((row) => !allReleased(plans.get(row.number) ?? []))` and computes `shown`/`hidden` from `unfinished`, not from the raw `selected`/`total`. `packages/domain/test/waiting-tickets.test.ts:289` already asserts "excludes a row named only by released plans from tickets and counts it in hidden" and passes today. **Do not re-fix this — it would be a no-op diff that re-litigates a settled question.**

**What is still open: a ticket whose plan is in a state `ticketPhase` doesn't recognise is miscounted as unplanned.** `ticketPhase` (`packages/domain/src/rules/ticket-phase.ts:52`) returns `null` when no plan naming the ticket has a state in `PLACED` (`draft`, `design`, `approved`, `delivered`, `released`) — e.g. every plan naming it is `rejected` or `superseded`. In `waiting-tickets.ts`'s `render()`, `phased.filter(({ phase }) => phase === null)` is the **unplanned** bucket (rendered first, per `ticketPhase`'s own ordering contract). A ticket named only by a `rejected` plan lands there — sorted and counted exactly like a ticket no plan names at all — even though `fleet.ts`'s `ticketPlansOf` (`packages/board/src/server/fleet.ts:1573-1591`) built a non-empty `TicketPlan[]` for it. The inbox (a tracker-account read, `source.match === 'tracker-account'`) never performs this join at all — it shows the tracker's raw state (`keepsTrackerState` branch, `waiting-tickets.ts:153,164`) and has no concept of "unplanned" to drop it from — so a host-login reader and an inbox reader disagree about whether that ticket is planned.

Fix this in the domain, not the board: give `allReleased`'s question a sibling, or extend it, so "every plan naming this ticket is in a state `ticketPhase` cannot place" is answered once and `render()`'s `phased` split asks it instead of relying on `phase === null` to mean "no plan names this." The current `phase === null` test conflates two different facts — *no plan names this ticket* and *a plan names this ticket in a state this rule doesn't render* — and only the first one means unplanned.

### Settled decisions — do not re-derive them

**`allReleased`/released-row exclusion is pre-existing, not part of this plan's scope.** Confirmed by diffing `84b1638e4` against the current file (identical) and by the passing test at `waiting-tickets.test.ts:289`. If you find yourself writing a fixture to prove released rows leak into `shown`/`hidden`, that fixture will fail to show a difference — the question was asked and answered before this plan existed.

**The inbox and the plan join are two different reads that must agree on one concept, not be reconciled after the fact.** `source.match === 'tracker-account'` rows keep the tracker's own state and skip the phase label (`keepsTrackerState`), by design — the plan's Design section only asks for one fix here ("The unknown-phase case in `fleet.ts:1575` and the inbox use one answer"), meaning the *is this ticket planned at all* predicate, not the *what label does it show* predicate. Don't make tracker-account rows start rendering plan phase labels; that re-opens a question the existing code already settled correctly.

**Any rule you add belongs in `packages/domain`, not `fleet.ts`.** Per *Every rendered state is a domain property* in CLAUDE.md: `fleet.ts:1573-1591` (`ticketPlansOf`) already does the mechanical join of ticket → `TicketPlan[]`; it should keep doing exactly that and nothing more. The decision — is this `TicketPlan[]` "nothing left to show" — is `waiting-tickets.ts`'s job, next to `allReleased`.

### Done when

The plan's `## Done when` is implicit in its Motivation/Design, so derive it here: a fixture with a ticket named only by a `rejected`-state plan must land in `hidden`/hidden-count accounting the same way an `allReleased` ticket does, and must NOT appear in the unplanned bucket ahead of genuinely unplanned tickets. Add the fixture to `packages/domain/test/waiting-tickets.test.ts` alongside the existing released-row test (line 289) so the two sit next to each other as the two halves of "finished, one way or another."

Also lift into tests: a case proving a host-login reader and a tracker-account (inbox) reader agree on whether the same ticket counts as planned — today nothing asserts this pair directly, and the Motivation's "the inbox and fleet.ts use one answer" framing implies a shared test fixture is the way to prove it, not two separately-passing suites that happen to agree by luck.

Plus the repo's standing gates: build the changeset (`@plot-pm/domain` or `plot`, per the versioning rules in CLAUDE.md — this is a domain rule fix, `patch` unless you also touch the board's rendering, which this slice should not need to). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves which of `packages/domain/**`'s test/typecheck commands apply to your changed files; do not run the full `pnpm run test:contracts` or `test:e2e` suites locally (CI's job, not a local one, per CLAUDE.md Testing section).

Name the shell gate too, even though this slice is domain-only and should touch no `.sh` file: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. It should be a non-issue here, but if a `.sh` helper edit creeps into scope, the growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create` — it reads which plan names the branch and titles the PR from the plan's wave heading ("Waiting on you"), which a hand-typed `gh` title would miss.

Once the PR number exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the `### Waiting on you` heading (`docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md:62`).

### Scope guard

This branch owns: `packages/domain/src/rules/waiting-tickets.ts`, `packages/domain/src/rules/ticket-phase.ts`, `packages/domain/test/waiting-tickets.test.ts`, and — only if the join truly cannot be expressed without it — `packages/board/src/server/fleet.ts`'s `ticketPlansOf` (read-only mechanical join; the decision stays in the domain).

Other branches in this plan, verified via `gh pr view`/`git ls-remote` at dispatch time: `bug/delivery-chips-decided-in-the-domain` is merged and gone (no live ref) — it owned `chip-row.ts`, `ownership.ts`, `sprint-selection.ts`, `AgentList.tsx`, `DeliveryFilters.tsx`, `chip-readings.ts`, none of which this slice touches. `bug/chip-and-inbox-tests-can-fail` has no remote ref yet (unclaimed) — it owns test/comment/changeset corrections and the single declarations of `NO_SPRINT`/`FilterOption`; it depends on this slice having landed its fixture convention in `waiting-tickets.test.ts`, so push this slice's PR before that one starts, or coordinate if both run concurrently.

If you find something the plan did not anticipate, report it rather than improvising outside scope — in particular, if the `phase === null` conflation turns out to already be handled somewhere else this review missed, say so rather than adding a redundant rule.
