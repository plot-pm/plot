# plot-undeliver never refuses refs-swept, and plot-reject does not call it

> `plot-undeliver.sh` finds no branches in current plans, so the `refs-swept` refusal never fires, and `/plot-reject` reverses a delivery by hand instead of through it.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2764
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-undeliver.sh` reads a plan's branches from its `## Slices` lines and refuses `refs-swept` when one has no remote ref. `/plot-reject` moves a delivered plan back to Approved through `plot-undeliver.sh`.

Board impact: none expected. The plan format does not change; `plot-undeliver.sh` and the `plot-reject` skill change, and the board bundle `plot-undeliver.sh` runs is rebuilt only if the domain transition changes.

## Motivation

On 2026-10-27 the #2760 panel ran `plot-undeliver.sh` on a scratch copy of the #2400 plan at `b2df79eaf`. `git ls-remote --exit-code --heads origin bug/plot-host-bitbucket-pr-list-reads` exited 2 (the ref is gone), and the script still decided `→ Approved`.

Two causes:

- `skills/plot/scripts/plot-undeliver.sh:79` collects branches with `grep -oE '\(Branch: [^,)]+'`. Current `## Slices` lines read `` - `branch` — … `` and contain no `(Branch: `, so `swept` is always empty. The domain `undeliver` transition (`packages/domain/src/transitions/plan.ts:749-822`) therefore never receives a swept ref and never refuses `refs-swept`.
- `skills/plot-reject/SKILL.md` steps 4–5 edit `State:` from Delivered to Approved by hand under `plot-state-receipt.sh --unowned`. No `SKILL.md` calls `plot-undeliver.sh`, so the rejection has no controller and none of its refusals can run.

Found by the panel on plan PR #2760 (`auto-deliver-re-delivers-a-rejected`); out of that plan's scope.

## Design

### Approach

1. `plot-undeliver.sh` reads branch names from the plan's `## Slices` section: the backticked name that opens each slice line. The domain already parses this format; the script should reuse that parse (for example through `plot-plan-meta.sh` `slices[].branch`) rather than add a second regex, and per *A Shell Script Asks The Domain* any remaining duplicate joins the corpus tier.
2. A test in `test/reconcile/` holds a plan in the current `## Slices` format whose slice ref is gone and asserts the script exits 1 with `refs-swept`. A second case holds a plan whose refs all exist and asserts it still decides `→ Approved`.
3. `skills/plot-reject/SKILL.md` steps 4–5 call `plot-undeliver.sh <slug> --why <reason>` in place of the hand edit and the `--unowned` receipt. A refusal from the script ends the rejection ([The Master Agent Uses The Controllers](../../CLAUDE.md)). The skill's Model Guidance table and `README.md` are updated with it.

### Open Questions

- [ ] Does `plot-undeliver.sh` leave the receipt `plot-state-gate.sh` requires, or does `plot-reject` still need `plot-state-receipt.sh`?
- [ ] Should the old `(Branch: …` form still be read for plans written before `## Slices`? Measure how many plans in `docs/plans/` still carry it before deciding.
- [ ] A plan whose slice ref is gone because its PR merged and the branch was deleted is also swept. Does `refs-swept` then refuse every rejection of a fully merged plan? The panel case suggests that is intended; confirm against the domain rule.

## Slices

### Refusal

- `bug/plot-undeliver-reads-slices` — `plot-undeliver.sh` reads branches from `## Slices`; test for `refs-swept`

### Controller

- `bug/plot-reject-calls-plot-undeliver` — `/plot-reject` moves the phase through `plot-undeliver.sh` <!-- waits: bug/plot-undeliver-reads-slices -->

## Notes

Created from tracker issue #2764. The tracker is not written to; the `Issue:` field is the only link.
