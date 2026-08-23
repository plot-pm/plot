# The board filters to the sprint

> The board shows 106 rows across every plan the estate has ever held. A sprint is a commitment about a subset of them, and nothing on the board can show you that subset or say how much of it is done.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The Board tab gains a sprint filter that narrows it to the active sprint's plans, and states that sprint's progress and its target release as numbers.

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

### Why the Board tab and not the Agents tab

Measured in the payloads:

- **`/api/board`** already carries `sprint` per card (`schema.ts:20`) and a
  `sprints` array (`:496`). The join this filter needs is already on the wire.
- **`/api/fleet`** carries **no sprint field at all** — not on a row, not at the
  top level.

So the Board tab can filter today and the Agents tab cannot without new plumbing.

That is convenient, but the deciding argument is what each tab is *for*: the
Agents tab answers **who is working right now**, and hiding a running agent
because its plan is out of scope would break the one section whose purpose is to
show every agent. A sprint is about *what the team committed to*, which is a
lifecycle question — the Board tab's subject.

**Agents stays unfiltered, deliberately.** If it later needs one, it needs a
`sprint` on the fleet row first, and that is a separate plan.

## Design

### The control states what it filters

One control at the top of the Board tab, showing the sprint's name, its target
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

- With an Active sprint, the toggle narrows the Board tab to that sprint's
  plans, and every hidden row belongs to a plan the sprint does not name.
- The control shows the sprint's **target release** and four counts, taken from
  `plan.status` and not recomputed. Asserted by construction — where the value
  comes from — not by comparing numbers.
- **With no Active sprint the toggle is present, disabled, and shows unreleased
  estate totals.** Asserted directly: this is the state a naive implementation
  hides, and hiding it passes every other assertion here.
- **Two Active sprints render two rows**, each with its own release and counts.
- The Agents tab is unchanged. Asserted, because the obvious implementation
  filters "the board" and reaches both tabs.
- Toggling writes nothing to the estate — no phase moves, no file changes.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Counted

- `feature/the-sprint-card-carries-its-numbers` — `SprintCardSchema` gains the target release and the four `status` counts, aggregated per active sprint on the server; no client change

### Filtered

- `feature/the-board-filters-to-the-sprint` — the Board tab's control: toggle, the counts, the disabled-with-totals state, and one row per active sprint

## Notes

Asked for 2026-08-23, after a sprint status that took four scripts and a hand
join to answer — and produced two defensible numbers that disagreed.

The scope question (*which tab?*) was settled by measurement rather than taste:
`/api/board` already carries `sprint` per card, `/api/fleet` carries none. The
tabs' subjects agree with that split, which is the more durable reason.

This plan is deliberately the **first consumer** of `plan.status` rather than
another producer of the same answer. If it ships computing its own counts, the
estate gains a fifth definition of *done* and the phase/status work buys nothing.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Which tab does the filter belong on?", "a": "Board only - /api/board already carries sprint per card and /api/fleet carries none; and hiding a running agent would break the section whose purpose is showing every agent", "category": "architecture"},
    {"q": "What does the counter count?", "a": "plan.status values from a-plan-has-a-phase-and-a-status, read not recomputed; a fifth local definition of done is the defect being fixed", "category": "domain"},
    {"q": "What happens with no active sprint?", "a": "Toggle disabled but VISIBLE, showing unreleased estate totals - a control that vanishes teaches the reader it does not exist", "category": "ux"}
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
