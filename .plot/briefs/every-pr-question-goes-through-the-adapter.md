## Implementation brief — every-pr-question-goes-through-the-adapter (slice: Routing every PR question)

- **Plan (canonical):** `docs/plans/2026-09-04-every-element-is-a-domain-concept.md` on `main`
- **Branch:** `feature/every-pr-question-goes-through-the-adapter` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 2 of six. Slice 1 (`a-merge-is-a-domain-question`) merged as **#706**.

## What this delivers

Every script asking the host *what is this PR's state* goes through `plot-host.sh`, and a grep gate stops the next one arriving unnoticed.

## The measurement, re-taken 2026-09-05

The plan names three scripts. **Counting live calls — excluding comment lines, which is the distinction the plan itself draws — gives this:**

```
plot-reconcile-scan.sh    3   (:291, :302 live; :1027 is advice text in output)
plot-pr-merged.sh         2
plot-agent-monitor.sh     1
plot-pr-state.sh          1
plot-update-board.sh      4   ← NOT IN THE PLAN
plot-budget.sh            0   (comments only — correctly excluded)
plot-worker-monitor.sh    0   (comments only — correctly excluded)
```

**The plan's two exclusions are right and verified:** `plot-budget.sh` and `plot-worker-monitor.sh` mention `gh` only in comments, zero live calls.

**`plot-update-board.sh` IS THE ONE THE PLAN MISSED, and it is a different question.** Its four calls are `gh project view`, `item-add`, `field-list` and `item-edit` — the **GitHub Projects** API, not the PR API. `plot-host.sh` answers `pr-state`, `pr-list`, `pr-merge`, `pr-create`, `pr-body`, `issue-list`, `issue-view` and nothing about projects.

**So it is NOT routing, it is capability**, which is exactly what the plan says this slice is not: *"This is duplication, not capability: the routing is mechanical and the adapter needs nothing new."*

**Decide and say which**, in the code:

- **Route the four PR/issue callers and exempt `plot-update-board.sh` by name**, with the reason — a board-project integration is a different host surface, and the gate carries a named exception the way `check-ancestry-decisions.sh` carries its two.
- Or **widen the adapter with project ops**, which makes this slice bigger than its plan describes and should probably be its own.

The first is the plan's shape. Take it unless something argues otherwise, and record the exemption where the gate can be read.

## Why this is second, not first

The plan is explicit: the two slices **fail in opposite directions.**

`plot-pr-merged.sh` answers *not merged* on an unreachable host, and the fleet quietly stops advancing — silence that looks like a decision. These three break **loudly** on a host with no `gh`. Loud failures wait; silent ones go first.

## The gate

**Asserted: no script outside `plot-host.sh` names `gh`** — a grep gate, so the next one cannot arrive unnoticed.

`scripts/check-ancestry-decisions.sh` is the model: it bans a *decision* rather than a call, and requires a declaration within five lines. This gate is simpler — a path check with a named exception list — and belongs beside it in CI.

**CLAUDE.md calls this the difference between a rule and a gate.** The prose rule *"`plot-host.sh` is the ONE place that talks to the host CLI"* has been in `CLAUDE.md` throughout, and four scripts violate it. That is the rule failing exactly as CLAUDE.md predicts.

## Testing

Each routed call must keep its current failure direction. `plot-reconcile-scan.sh:291` and `:302` are on the reconcile path; `plot-agent-monitor.sh:239` is a monitor finding; `plot-pr-state.sh:12` is the plan-PR query. Routing must not turn a tolerated failure into a fatal one.

Gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and the new grep gate must fail on a deliberately added `gh` call.

## Done when

- `plot-reconcile-scan.sh`, `plot-agent-monitor.sh` and `plot-pr-state.sh` ask the host only through `plot-host.sh`
- `plot-update-board.sh` is either routed or exempted **by name and with its reason recorded**
- a grep gate fails CI when a script outside `plot-host.sh` gains a live `gh` call
- every routed call keeps its current failure direction
- the gates above pass

## Do not

- **Do not touch `plot-pr-merged.sh`.** That was slice 1, merged as #706.
- **Do not route `plot-budget.sh` or `plot-worker-monitor.sh`.** Comments only, deliberately excluded — verified 2026-09-05.
- **Do not widen `plot-host.sh` with project operations** without saying so plainly; that is capability, and this slice is routing.
- **Do not let the gate match comment lines.** The two exclusions above are comment-only mentions, and a gate that flags them would be reverted on its first run.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
