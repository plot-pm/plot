# Panel moderation: delivery-work-items-show-gates

Subject: `docs/plans/active/delivery-work-items-show-gates.md` at `a1bbe74ca`.
Siblings: 7 read, 0 unread (no sprint is active; every unfinished plan in `docs/plans/active/`).
Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). All four gated and committed.

## What each juror looked at

All four read the plan, the six sibling delivery plans, the design spec and the code at HEAD (`delivery-row-form.ts`, `delivery-placement.ts`, `delivery-readings.ts`, `delivery-row-facts.ts`, `delivery-link-targets.ts`, `schema.ts`, `glyphs.ts`, `fixer-attempts.ts`). None ran code or the board. Every finding is a reading, not an execution.

## Agreements (all four jurors)

1. **The gate marks already exist.** `GATE_MARK` and `gateValue` (`delivery-row-form.ts:91, 139`) render ✓ ⟳ ✗. The Open Question names `glyphs.ts`, which holds kind icons only. `gateValue` shows one gate per row, so `CI ✗ validate · review –` is a change to an existing function.
2. **Role chip has two owners and no order.** This plan and plan 4 (`feature/delivery-fleet-agent-rows`) both build it in `delivery-row-form.ts`; this plan's By slice waits only on `feature/delivery-section-header`. `AgentRole` (`delivery-placement.ts:93`) has six roles; the design and plan 4 name eight.
3. **Four readings are not in the payload, and no plan adds them:** a CI run link and check name (`ciRun` is never set; `prUrl` is `() => null`), the agent role (every agent reads `loop`), the fixer attempt count (`corrections` is never mapped), and a per-slice commit count.
4. **The Board impact line contradicts CLAUDE.md** (`check-no-bundle-diff.sh`): a rebuild is a local test, never part of the commit.

## Disagreements and distinctions

- **No juror held `reject`.** The divide is one of emphasis, not position. Estate and cost weigh what already exists; deliverable weighs Done When coverage; contradiction weighs sibling ordering.
- **Queued contents.** Contradiction alone found that Queued holds tickets, Draft plans and approval-owed items today, and that "waits on the earlier slice" contradicts the not-started exclusion. Estate found the removed not-started slices also lose today's Start (`dispatch`) control (`AgentList.tsx:1219`). These are two views of one gap: the plan does not say what Queued holds after the exclusion.
- **Fixer budget.** Estate and cost found two denominators: the `Correction budget` config key and `FIXER_ATTEMPTS_BUDGET = 2` counted per finding kind. Cost noted both are 2 today, so a test would pass by coincidence.
- **Dependencies.** Contradiction and cost found no `waits:` on plan 2's PR rule or plan 1's release-row removal; cost added that five slices across plans edit `delivery-row-form.ts` and the 1632-line `AgentList.tsx`.
- **Done When coverage** (deliverable only): no item checks the role chip, the Fleet link, the header counts, "oldest waits", Progress, Waits on, or the Where change.

## Shared blind spot

All four jurors read code and plans and none ran the board. The `Not verified` items they name stand: whether `.plot/state/fixer-attempts/<pr>.json` records a count, whether the host listing carries CI run ids for slice PRs, whether fleetd fixers and reviewers appear as registry entries, and which browser tests select the current columns.

## Nothing acted on

The panel reports. No phase moved, nothing was approved or rejected.
