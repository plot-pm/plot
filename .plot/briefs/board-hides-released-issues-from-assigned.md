## Implementation brief — released-plans-leave-their-github-issues (wave: Board filter)

- **Plan (canonical):** [docs/plans/2026-10-23-released-plans-leave-their-github-issues.md](../../docs/plans/2026-10-23-released-plans-leave-their-github-issues.md) on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2361 merged
- **Branch:** `bug/board-hides-released-issues-from-assigned` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard repo PR review

This plan's other slice, `bug/released-plans-close-their-github-issues`, merged
2026-10-23 (`c2a856c2c`, PR #2373) — the release path now closes GitHub issues
on `released`. This branch does not depend on that mechanism; it is a read-side
fix and the two slices touch disjoint files.

### What to build

After `/plot-release 2.28.0` on 2026-10-22, *Assigned to you* kept listing 63
closed-on-GitHub issues because every one of them still named a plan — a
Released one. The board does not hide a ticket because a plan names it; it
hides one because **no unfinished plan** names it (an issue no plan names at
all falls back into the unplanned inbox and is filtered there instead). Today
nothing asks "are all the plans naming this issue Released" — `ticketPhase`
(`packages/domain/src/rules/ticket-phase.ts:53`) picks the *least advanced*
plan's label when several name one issue, so an issue with one Approved and
one Released plan correctly shows `in progress`; but an issue every plan has
finished still renders, now labelled `released`, because nothing besides the
label changes.

Add the omission `ticketPhase` doesn't give you: a property computed from the
same `TicketPlan[]` that already reaches `ticketPhase`, answering whether
every plan in the list is `released`. Wire it into `waitingTickets`
(`packages/domain/src/rules/waiting-tickets.ts:140`) so a row whose plans are
all released is excluded from `render`'s `selected` set, the same way a row
that doesn't match `ownership` already is.

### The decisions the plan settles — do not re-derive them

**This is a domain property, not a view decision.** CLAUDE.md's rule —
*every rendered state is a domain property* — is cited directly in the plan's
Design (§ Approach, point 3: "The decision belongs in the domain, as a
property the view reads"). Don't filter in `AgentList.tsx` or `waiting-view.ts`;
both are pure rendering of whatever `FleetWaiting.tickets` already contains.
The exclusion has to happen before the wire shape is built, inside
`waitingTickets` or a rule it calls — so a unit test on the domain function
proves the badge (here, the row's absence) without a browser, per the same
section's measurable form.

**Reuse the `every(state === 'released')` idiom already in this codebase,
don't invent a second one.** `workflow-phases.ts:238` computes exactly this —
`releasedOnly: entry.plan.every((state) => state === 'released')` — for the
planning board's columns. `ticket-phase.ts` already receives the same shape
(`TicketPlan[]`, each with a lowercased `.state`), so the natural home for the
new predicate is beside `ticketPhase` in `ticket-phase.ts`, taking the same
`readonly TicketPlan[]` and returning a `boolean` — e.g. `allReleased(plans)`.
`plans.length === 0` must answer `false` ("all released" of an empty set is
vacuously true but means something different here: a ticket *no* plan names is
unplanned, not released-and-hidden, and that case is handled upstream by
`referencedIssues`, never by this predicate).

**Why the row survives in `rows` at all, and why that's correct to leave
alone.** `referencedIssues` (`packages/board/src/server/fleet.ts:1486`)
deliberately keeps a Released plan's issue reference forever — its own comment
says so: *"A released plan is still the decision that was made about its
issue… The reference is what makes the row disappear, so it has to outlive the
branch."* That comment was written before this bug and is still correct for
what it governs: it stops a released issue from falling back into the
**unplanned inbox** once its plan's branches are reaped. It was never meant to
keep the issue in *Assigned to you* forever, and nothing in that function
needs to change. The gap is one level up, in `waitingTickets`, which has
always rendered every referenced row it's handed, trusting `ticketPhase` to
label it correctly — label is not the same question as "should this row show
at all," and that's the distinction this slice adds.

**Where in `waitingTickets` to apply it.** `render()`
(`waiting-tickets.ts:153`) already maps `selected` through `ticketPhase` via
`plans.get(row.number)`. Filter `selected` by `!allReleased(plans.get(row.number)
?? [])` before computing `phased`, in every one of `render`'s three call sites
(`source === null`, `host-login`, `tracker-account`) — they all funnel through
the same `render`, so filtering inside it (once) covers every source, rather
than filtering at each of the three call sites separately. **`shown`/`hidden`
must still reconcile against `total = rows.length`** (the function's own
contract, `waiting-tickets.ts:149`): an excluded row counts toward `hidden`,
the same as a row `ownership` didn't match. Don't special-case it as a fourth
bucket — the existing `hidden` sentence ("N open tickets are not assigned to
you") still reads correctly for a row this reader can't see because it's done,
not because it's someone else's.

**This governs *Assigned to you* only, per the plan's own Open Question.** The
plan explicitly scoped this to the one view ("The issue says only the
latter" — referring to *Assigned to you*, not the issue inbox). `waitingTickets`
is the function behind that one block (`waiting-view.ts`'s `WaitingView`,
rendered by `AgentList.tsx`'s *Waiting on you* section) — it is not reused by
the separate unplanned-issues inbox path (`inboxOf`, `fleet.ts:1837`, which
reads `referencedIssues` directly and has no `TicketPlan` concept at all). Filtering
inside `waitingTickets` therefore naturally stays scoped to the one view the
plan asked for; don't thread the new predicate into `inboxOf` or
`referencedIssues`.

### Done when

The plan's `## Done when` list doesn't exist as written (this plan has no
explicit `## Done when` section — the Changelog and Motivation together are
the spec): an issue named only by Released plans no longer appears under
*Assigned to you*, labelled or not; an issue named by at least one unfinished
plan still appears, labelled by that plan per the existing `ticketPhase` rule
(unchanged). Add tests that catch what a naive fix would miss:

- A unit test on the new predicate: `[]` → `false`; `[released]` → `true`;
  `[released, released]` → `true`; `[released, approved]` → `false` (this is
  the case a naive "any released" check would get wrong and hide a still-open
  issue).
- A `waitingTickets` test: a row named only by released plans is absent from
  `tickets` AND counted in `hidden`, not just missing from the label.
- A `waitingTickets` test: a row named by one released and one approved plan
  still renders, labelled `in progress` (regression guard — this is the
  scenario the Motivation's "unless another unfinished plan names the same
  issue" sibling rule from slice 1 mirrors on the read side, and it's the case
  most likely to regress silently since both this slice and slice 1 touch
  "another plan still open" logic independently).

Plus: the repo's gates — a changeset (`@plot-pm/board`, patch; cite
`plan: docs/plans/2026-10-23-released-plans-leave-their-github-issues.md` on
its own line, description first, per CLAUDE.md's Versioning section order
rule). No change to `packages/domain` arrow-function style is implied here
beyond what's already true: `ticket-phase.ts` is already arrow-only, so the new
export follows the same shape as `ticketPhase` itself. For tests, run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run
what it prints; the suites in the `CI suites` config key run in CI — list no
full suite here.

Name the shell gate too: `scripts/check-shell-lines.sh` refuses a PR whose
shell under `skills/` grew past its merge base. This slice touches no `.sh`
file, so it should cost nothing against that budget — if a change here somehow
needs one, that growth has to be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the branch exists and carries a
commit:

```bash
../plot/scripts/plot-open-pr.sh          # the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Never `gh pr create` directly — see CLAUDE.md, *The Master Agent Uses The
Controllers*. Push the first real commit as soon as it exists, so the branch
stops looking abandoned to `/plot-pulse`. When the PR is created, append
`→ #<number>` to this branch's line in the plan's `## Slices` section
(`### Board filter`).

### Scope guard

This branch owns:
- `packages/domain/src/rules/ticket-phase.ts` and its test
- `packages/domain/src/rules/waiting-tickets.ts` and its test
- the new changeset file

It does not own, and should not touch:
- `packages/domain/src/rules/issue-status.ts`, `tracker-plan-state.ts`,
  `plot-deliver.mjs`, `plot-plan-state.mjs` — all slice 1, already merged
- `packages/board/src/app/lib/agent-rows/waiting-view.ts` or
  `AgentList.tsx` — pure rendering, unchanged by this fix per the domain-property
  rule above

The sibling slice (`bug/released-plans-close-their-github-issues`) is already
merged into `main` — this branch bases on current `main`, which already
carries it, so there is no rebase-for-a-moving-sibling concern here.

If you find something the plan did not anticipate — e.g. the issue inbox
(`inboxOf`) turning out to need the same filter after all — report it rather
than expanding this branch's scope to cover it.
