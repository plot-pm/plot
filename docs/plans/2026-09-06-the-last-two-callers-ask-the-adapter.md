# The last two callers ask the adapter

> `every-pr-question-goes-through-the-adapter` merged as #717 and cleared two of four callers. It left `plot-pr-merged.sh` by instruction and `plot-update-board.sh` unmeasured, and the grep gate it promised did not ship — so nothing stops a third arriving.

## Status

- **State:** Released
- **Type:** infra
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-06, Jan Wloka, in-session
- **Rounds:** 3
- **Started:** 2026-09-06, Jan Wloka, `infra/the-project-api-is-named`
- **Delivered:** 2026-09-07
- **Released:** 2026-09-08, 2.14.0

## Changelog

- The two scripts still calling `gh` directly ask `plot-host.sh` or declare why they cannot, and a gate refuses the next one.

<!-- Board impact: none. The adapter's answers are unchanged; only who asks. -->

## Motivation

**#717 did what it set out to do and stopped where it was told.** Measured 2026-09-06, after it merged:

```
plot-agent-monitor.sh   1 → 0   routed
plot-pr-state.sh        1 → 0   routed
plot-pr-merged.sh       2 → 2   excluded by the brief
plot-update-board.sh    4 → 4   not in the plan
plot-reconcile-scan.sh  3 → 1   the remaining line is advice TEXT, not a call
```

**`plot-pr-merged.sh` WAS EXCLUDED FOR A REASON THAT HAS EXPIRED.** The brief said *"Do not touch it — that was slice 1, merged as #706."* Slice 1 moved the merge question into the domain; it did not stop the shell helper calling `gh` directly at `:90` and `:99`.

**AND THE ADAPTER ALREADY ANSWERS THE QUESTION.** `plot-host.sh:17` declares `pr-merged <branch>` — *"has ANY PR for this branch merged?"* — with three answers on exit 0, `unknown` among them. `plot-pr-merged.sh` runs its own `gh pr list --json mergedAt` beside it.

**Two implementations of one question, in the one place this repo argued hardest that there must be exactly one.** The file's own header says it was extracted *"because ref deletion needs the SAME gate and the two must never disagree"*. It now disagrees with the adapter instead of with the reaper.

**`plot-update-board.sh` IS A DIFFERENT QUESTION AND #717's BRIEF SAID SO.** Its four calls are `gh project view`, `item-add`, `field-list`, `item-edit` — the Projects API. `plot-host.sh` answers no project operation. That is capability, not routing, and it needs a decision rather than a move.

**THE GATE DID SHIP, AND IT ALREADY NAMES THIS WORK.** `scripts/check-host-cli-callers.sh` landed 2026-09-05 and answers `Host CLI callers: clean` on the estate today, over **27 call sites in exempted scripts**.

**It exempts by name, with a reason, and one of those exemptions is dated on purpose.** Its own header, on `plot-pr-merged.sh`:

> *"The exemption is dated, unlike the three above it: those describe questions the adapter does not answer, this one describes work not yet done. Delete this entry when the lookups route."*

**So this plan is the work that entry is waiting for**, not a plan to build a gate that exists. The gate's other exemptions describe capability the adapter genuinely lacks; this one describes a routing that has not happened. Landing slice 1 deletes it.

**And the gate tests its own refusal** — `test/reconcile/host-cli-gate.test.mjs`, because *"a gate nothing tests is a gate that passes because nobody looked."*

## What this is not

**Not a re-run of #717.** Two files, both named, both measured after it merged.

**Not a change to any answer.** `pr_merged` reads `mergedAt`, never `state`, across ANY PR, and an unreachable host answers *not merged*. Routing must preserve every one of those, including the failure direction.

## Slices

### The merge gate asks the adapter (Branch: infra/the-merge-gate-asks-the-adapter, PR: #725)

`plot-pr-merged.sh` calls `plot-host.sh pr-merged` instead of `gh`.

**THE DECISION HAS ALREADY MOVED. ONLY THE LOOKUP HAS NOT.** Checked against the estate 2026-09-06, and it corrects two earlier rounds of this plan: `plot-pr-merged.sh` **is already an adapter**. #706 made it one — `:69` resolves `board/plot-landed.mjs`, `:78` pipes two readings into it, and `rules/landed.ts` holds `landed`, `openPr` and `mayRemove`.

**The coupling is already asserted rather than commented.** The file says so: *"That was a comment in this file and could not be checked. It is now `mayRemove` in the rule, asserted over all nine combinations of the two readings, and exactly one of them permits a removal."*

**So there is no gate left to move, and the earlier rounds argued about one.** What remains is narrower and unchanged by any of it: **two `gh` calls** at `:90` and `:99` that ask the host directly instead of through `plot-host.sh`. The functions turn each lookup into `found`, `none` or `unaskable` — three readings the adapter's `pr-merged` already produces.

**THE COST ARGUMENT STILL DECIDES THE SHAPE.** `plot-pr-merged.sh` is **sourced, not run**: four scripts define these functions in their own shell and call them per branch. A version shelling out to `plot-host.sh` adds one process per call on a path the fleet scan walks across 48 branches, and `DESIGN-machine.md` measures spawn cost as the headroom signal. So the lookup routes without gaining a spawn, or it does not route.

**THE FAILURE DIRECTIONS ARE ALREADY RECONCILED IN THE RULE.** `landed` receives `unaskable` as a reading and `mayRemove` refuses on it — the three-to-two mapping this plan's round 1 said needed asserting is asserted, over nine combinations. Routing the lookup must not disturb it: the adapter's answers arrive as the same three readings.

**Done when** `plot-pr-merged.sh` names `gh` zero times, its lookups go through `plot-host.sh`, no caller gains a process per branch, the three readings reaching `rules/landed.ts` are unchanged, and `mayRemove`'s nine assertions still pass.

### The board updater is routed or exempted (Branch: infra/the-project-api-is-named, PR: #745)

`plot-update-board.sh` asks the adapter, or is exempted by name with its reason recorded.

**IT IS CAPABILITY, NOT ROUTING**, and that distinction is #717's own words. Widening `plot-host.sh` with four project operations is a bigger change than moving a call, and it makes the adapter answer for a second GitHub API family with no Bitbucket equivalent.

**THE EXEMPTION IS THE LIKELIER ANSWER AND IT MUST BE WRITTEN DOWN.** `scripts/check-ancestry-decisions.sh` is the model: it carries named exceptions with declarations beside them, so an exception is a decision a reader can find rather than a hole.

**Done when** `plot-update-board.sh` either asks the adapter or carries a named exemption the gate reads, and the reason is in the file.

## Notes

### The third slice was withdrawn before approval — 2026-09-06

This plan was drafted with a slice building `scripts/check-gh-callers.sh`, on a measurement that no such gate existed. **It does**: `check-host-cli-callers.sh` shipped 2026-09-05, tests its own refusal, and already carries a dated exemption naming slice 1 as the work it waits for.

The measurement was taken with `ls scripts/check-*gh*`, and the gate is named for the *host CLI* rather than for `gh`. **A grep that spells the thing one way finds nothing when the estate spells it another** — which is the same failure this plan's own slice 3 was written to prevent, arriving one level up.

### Two rounds argued about work already done — 2026-09-06

Rounds 1 and 2 debated where the merge gate should live and how its three answers map to two. **Both had already been settled by #706**, in the file the plan is about, with the reasoning written in its header.

Neither round checked. The plan was read, the adapter was not — and the correction came from grepping for the deliverable rather than from another round of reasoning about it. **That is the fifth time this week** the estate already held what a plan proposed.
