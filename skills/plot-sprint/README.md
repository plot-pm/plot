# plot-sprint

Sprint management for the Plot planning system.

## Purpose

Adds time-boxed coordination to Plot. Sprints group work by schedule (start date, end date, MoSCoW priorities) while plans group work by scope. Sprint files live in `docs/sprints/` and are committed directly to main — no PR workflow.

## Structure

```
skills/plot-sprint/
├── SKILL.md    # Sprint lifecycle: create, commit, start, close, status
└── README.md   # This file
```

Helper scripts live with the hub, in `skills/plot/scripts/`:

| Script | Used by |
|--------|---------|
| `plot-sprint-candidates.sh` | Create step 4 — every unfinished plan with its title, story and changelog, so the goal can be read against them. Collects; ranks nothing |
| `plot-sprint-release.sh` | Close step 2b and `/plot-release` — the sprint's `Release:` target and per-item states |

> **Automated runner:** `ralph-sprint.sh` and the `/ralph-plot-sprint` iteration skill have moved to [`skills/ralph-plot-sprint/`](../ralph-plot-sprint/). Install from there.

## Tier

Reusable/publishable. Project-agnostic — works with any repo that adopts Plot conventions.

## Testing

E2E test scenario:

```
Test scenario: test-sprint
1. /plot-sprint week-1: Ship authentication improvements
   — verify the proposal ranks auth-flavoured plans above unrelated ones, that
     every row shows the sentence that earned it a place, and that a relevant
     plan from another story is still offered
   — verify nothing reached the sprint's tiers before a selection was made
   — repeat with --all and verify the full estate is listed, grouped by story
2. Add items: 1 plan-backed [slug] reference + 2 lightweight tasks across MoSCoW tiers
3. /plot-sprint commit week-1 — verify end date required
4. /plot-sprint start week-1 — verify active/ symlink created
5. Complete one must-have, leave one should-have incomplete
6. /plot-sprint close week-1 — verify MoSCoW completeness check, deferred handling
7. Verify retrospective prompting works
8. Run /plot on main — verify sprint appears with countdown/progress
9. Verify plan-backed [slug] cross-references resolve correctly
10. Verify active/ symlink removed on close
```

Spoke awareness tests:
- Run a plan lifecycle with `Sprint: week-1` field populated
- Verify `/plot-approve` mentions sprint membership
- Verify `/plot-deliver` shows sprint progress

## Provenance

Designed as part of the sprint support plan (`docs/plans/2026-02-11-plot-sprint-support.md`). Key design decisions:
- Dedicated command rather than conditional paths in existing spokes
- Direct-to-main commits (sprints are coordination artifacts, not implementation plans)
- MoSCoW priority tiers with adaptation-not-deletion principle
- Single `active/` symlink directory (no `closed/` — identified by Phase field)

The goal-driven proposal at create step 4 came later, from
`docs/plans/2026-08-18-a-sprint-names-what-it-ships.md`, after this repo ran its
first sprint six months post-support and found the selection step listing all 53
open plans identically for every goal. Its decisions:

- **Frontier, and the Model Guidance table says so.** The match is semantic: the
  measured case is goal *"the board tells the truth"* against plan *"none printed
  before the first fetch"* — same subject, no shared word. Word overlap ranks
  that plan last, so the step cannot be computed.
- **The fallback below Frontier is the old behaviour, announced.** This is the
  one step in the skill where a smaller model cannot degrade into asking the
  human, because handing over every open plan is what it replaces.
- **Proposes, never adds.** A MoSCoW tier is a commitment; the ranking is help
  with finding candidates, not with making the commitment.
- **Reason on every row**, because the proposal will sometimes be wrong and an
  unexplained ordering hides its mistakes.
- **Candidacy from the phase, not `docs/plans/active/`** — that index is a
  symlink view that drifts, and `/plot-reconcile` exists for the drift.

## Known Gaps

- No cross-sprint item tracking (items can't span multiple sprints automatically)
- No velocity metrics (intentional — Plot tracks what shipped, not how long it took)
- No automated sprint creation cadence (manual trigger only)
