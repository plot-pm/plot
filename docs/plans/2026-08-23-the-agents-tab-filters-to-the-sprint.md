# The Agents tab filters to the sprint

> The Agents tab shows every branch and wave the estate holds. A sprint is a commitment about a subset of them, and nothing on the tab where work is actually watched can show you that subset or say how much of it is done.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The Agents tab gains a sprint filter that narrows it to the active sprint's plans, and states that sprint's progress and its target release as numbers.

<!-- Board impact: contract + server + client. SprintCardSchema gains a release
     target and four counts; the Board tab gains one control. No plan-format
     change and no docs/plans-layout change. Rebuild the artifact. -->

## Motivation

Measured 2026-08-23: the board renders **106 rows**, drawn from every plan in
`docs/plans/`. The active sprint commits to **19** of them. There is no way to
see only those, and no number anywhere that says how far along the sprint is.

The cost is not that the board is long. It is that **the sprint's own progress
cannot be read off it** — the question *"where do we stand?"* was answered this
afternoon by running four scripts and joining their output by hand.

Worse, the hand-count and the board disagreed, and both were defensible:

```
by merged branches   6 done      ← what a branch-based counter would show
by plan phase        1 done      ← what the release gate reads
```

Neither is wrong; they answer different questions. **That disagreement is what
`a-plan-has-a-phase-and-a-status` exists to end**, and this plan is its first
consumer.

### The Agents tab is where the work is watched

**Operator decision, 2026-08-23: the filter belongs on the Agents tab, and not
on the Board tab at all.**

An earlier draft of this plan recommended the opposite, from a measurement:
`/api/board` already carries `sprint` per card, `/api/fleet` carries none, so
the Board tab could filter today. That is true and it is the wrong reason to
choose. **Cheapness is not a subject.**

The Agents tab is where a person looks to see what is moving and what needs
them — waves, branches, blocked workers, things waiting on a decision. That is
where "is this in our sprint?" is actually asked, and where an out-of-scope row
is actually noise. The Board tab is a lifecycle overview whose cards are already
grouped by phase; narrowing it answers a question nobody had.

**What that costs, stated plainly:** the fleet payload has no sprint field, so
this plan has to put one there. That is the work, and it is worth it.

### The row already knows its plan

`AgentRow` carries **`planFile`** (`schema.ts:1727`) — the file the row's plan
lives in. A sprint is a field on that plan, so the join exists; nothing needs to
be inferred from a branch name.

**Set the sprint on the row where the row is CREATED, in the server** — never
derived in the renderer from `planFile`. The contract already paid for that
lesson once, in the same file:

> `kind` is set where the row is CREATED, because the server is the only place
> that knows why the row exists. … A derivation is a guess with a rule attached.

A renderer-side join would have to re-read plan metadata the client does not
hold, and would go wrong first on exactly the rows that have no plan.

### What the filter actually removes, measured

Live payload, 2026-08-23:

```
rows on the Agents tab           120   (113 waves, 5 branches, 1 PR, 1 release)
distinct plans behind them        47
plans the active sprint commits to 19
```

So the filter takes the tab from **120 rows to roughly 45** — a real improvement
and **not** a scannable list. One plan can contribute seven wave rows
(`the-wave-is-a-thing-the-board-can-hold` does), so sprint membership alone
cannot make the tab short.

**That is accepted, deliberately.** Wave-level density is a different problem and
already has owners: `a-folded-plan-says-what-it-hides`,
`a-split-plan-says-it-is-split`, and the wave modelling in
`the-wave-is-a-thing-the-board-can-hold`. Folding under the filter was proposed
and **rejected as scope**: it would duplicate behaviour another plan owns, and
two plans implementing folding is worse than a long list.

The claim this plan may make is *"these rows are the sprint's"*, not *"the tab
is now short"*. Stating that here so a reader is not disappointed by 45 rows.

### Rows with no plan are not filtered out

Measured, they are **exactly two of the 120 rows** — and both are load-bearing:

```
RELEASE  changeset-release/main    ← how a release is cut
PR       #57 (no plan behind it)   ← precisely what a sprint view must not hide
```

An earlier draft called this a broad class of rows. It is not; it is two. **The
assertion stands anyway**, because the count is not the argument: the release
row is the control you reach for at the end of a sprint, and an unplanned PR is
the thing most worth noticing. They belong to no sprint because they are
*outside the question*, not out of scope.

Hiding them would make the filter delete the fleet's own furniture — and the
naive predicate does exactly that.

**This is the assertion a naive implementation fails**: filtering on
`row.sprint === activeSprint` silently removes every plan-less row.

## Design

### The control states what it filters

One control at the top of the Agents tab, showing the sprint's name, its target
release, and its counts:

```
[✓] the-board-tells-the-truth-in-every-section → 2.9.0
    1 delivered · 5 deliverable · 2 in progress · 11 approved
```

**The counts are the point, not decoration.** `deliverable` is the actionable
one: plans whose every wave has merged and whose delivery decision is
outstanding. Five sit there now, and nothing on the board says so.

### It reads `plan.status`, it does not compute it

The four counts are `status` values from
`a-plan-has-a-phase-and-a-status` — `delivered`, `deliverable`, `in-progress`,
`approved` — aggregated per sprint on the server.

**This plan must not derive them itself.** Four consumers already answer *is
this plan done?* their own way, and that is the defect being fixed; a fifth
would make it worse. If the status field is not available when this is
implemented, **stop and say so** rather than computing counts locally.

> Dependency: `feature/a-plan-reports-its-status`.

### No active sprint: disabled, visible, and still counting

When no sprint is Active the toggle is **disabled but shown**, and the counts
become the estate's unreleased totals under the same four headings.

**Disabled rather than hidden**, because a control that vanishes teaches a
reader it does not exist; one that is visibly unavailable teaches them a sprint
would enable it. The numbers stay useful either way — they are the same
question asked of a wider set.

The release line reads nothing rather than a placeholder: absent is not false,
and *"→ —"* is noise.

### Two sprints may be Active

The estate permits it (two teams, one train — `plot-sprint-release.sh` reports
every active sprint). The control shows **one row per active sprint**, each with
its own release and counts, each independently toggleable.

Not chosen: pick the newest and ignore the rest. It would silently hide a
commitment, which is the failure this plan is about.

### Filtering is a view, never a state change

The toggle hides rows. It writes nothing, changes no phase, and does not
persist to the estate. Per-viewer persistence (remembering the toggle across
reloads) is a browser-storage concern and explicitly optional.

### Open Questions

- [ ] Should a filtered-out plan that is **blocking** an in-sprint plan still
      show? A dependency outside the sprint is invisible under the filter, and
      *why is this blocked* becomes unanswerable. Possibly show it, marked as
      out-of-scope, rather than hiding it.
- [ ] Does the count include plans a sprint **deferred**? They are in the file,
      under `### Deferred`, and are not commitments. Recommend excluding them
      and saying so on the control, since a count that silently includes
      deferred work overstates the commitment.

## Done when

- With an Active sprint, the toggle narrows the Agents tab to that sprint's
  plans, and every hidden row belongs to a plan the sprint does not name.
- **A row with no plan (`planFile: ''`) stays visible under the filter** — a
  release row, an issue row, an agent holding no branch. Asserted directly: the
  obvious `row.sprint === active` predicate removes all of them, and passes
  every other assertion here.
- `sprint` is set **in the server**, at row creation. Asserted by construction —
  where the value comes from — not by reading a rendered string.
- The control shows the sprint's **target release** and four counts, taken from
  `plan.status` and not recomputed.
- **With no Active sprint the toggle is present, disabled, and shows unreleased
  estate totals.** Asserted directly: this is the state a naive implementation
  hides, and hiding it passes every other assertion here.
- **Two Active sprints render two rows**, each with its own release and counts.
- **The Board tab is unchanged.** Asserted, because the obvious implementation
  filters "the board" and reaches both tabs.
- Toggling writes nothing to the estate — no phase moves, no file changes.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Carried

- `feature/the-fleet-row-carries-its-sprint` — `AgentRow` gains `sprint`, set in the server where the row is created by joining `planFile` to the plan's `Sprint:` field; rows with no plan carry `''`. No client change, no filtering yet

### Counted

- `feature/the-fleet-knows-its-sprints` — the fleet payload carries each Active sprint with its target release and its four `status` counts, aggregated server-side from `plan.status`

### Filtered

- `feature/the-agents-tab-filters-to-the-sprint` — the control: toggle, the counts, the disabled-with-totals state, one row per active sprint, and plan-less rows always visible

## Notes

Asked for 2026-08-23, after a sprint status that took four scripts and a hand
join to answer — and produced two defensible numbers that disagreed.

The scope question (*which tab?*) was answered by the operator against this
plan's own first recommendation. I proposed the Board tab because `/api/board`
already carries `sprint` and `/api/fleet` does not — a measurement about cost,
offered as though it were a measurement about fit. The Agents tab is where work
is watched and where an out-of-scope row is noise; the Board tab is a lifecycle
overview already grouped by phase. **Cheapness is not a subject**, and the
missing field is the work rather than an argument against it.

This plan is deliberately the **first consumer** of `plan.status` rather than
another producer of the same answer. If it ships computing its own counts, the
estate gains a fifth definition of *done* and the phase/status work buys nothing.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {"q": "Which tab does the filter belong on?", "a": "AGENTS TAB ONLY - operator decision, against my Board-tab recommendation. The Agents tab is where work is watched; the missing sprint field on the fleet row is the work, not an argument against it", "category": "architecture"},
    {"q": "What does the counter count?", "a": "plan.status values from a-plan-has-a-phase-and-a-status, read not recomputed; a fifth local definition of done is the defect being fixed", "category": "domain"},
    {"q": "What happens with no active sprint?", "a": "Toggle disabled but VISIBLE, showing unreleased estate totals - a control that vanishes teaches the reader it does not exist", "category": "ux"},
    {"q": "Does filtering by sprint make the tab readable? Measured 120 rows, 113 of them waves, 47 plans, sprint commits to 19", "a": "No - it lands at ~45 rows because one plan can contribute 7 waves. ACCEPTED as scope: density belongs to a-folded-plan-says-what-it-hides and the wave modelling. The claim is `these rows are the sprint`, not `the tab is short`", "category": "tradeOffs"},
    {"q": "How broad is the plan-less row class?", "a": "Exactly 2 of 120 - the release row and an unplanned PR. Assertion kept: the count is not the argument, the release row is the control you reach for at sprint end", "category": "ux"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
