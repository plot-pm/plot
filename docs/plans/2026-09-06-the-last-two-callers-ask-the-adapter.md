# The last two callers ask the adapter

> `every-pr-question-goes-through-the-adapter` merged as #717 and cleared two of four callers. It left `plot-pr-merged.sh` by instruction and `plot-update-board.sh` unmeasured, and the grep gate it promised did not ship — so nothing stops a third arriving.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

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

**THE GATE DID NOT SHIP.** #717's brief asserted *"no script outside `plot-host.sh` names `gh` — a grep gate, so the next one cannot arrive unnoticed."* Measured 2026-09-06: no such script exists under `scripts/`. The rule is prose again, which CLAUDE.md says is a rule that will eventually be violated — and this plan exists because it already was.

## What this is not

**Not a re-run of #717.** Two files, both named, both measured after it merged.

**Not a change to any answer.** `pr_merged` reads `mergedAt`, never `state`, across ANY PR, and an unreachable host answers *not merged*. Routing must preserve every one of those, including the failure direction.

## Slices

### The merge gate asks the adapter (Branch: infra/the-merge-gate-asks-the-adapter)

`plot-pr-merged.sh` calls `plot-host.sh pr-merged` instead of `gh`.

**THE FAILURE DIRECTION IS THE WHOLE RISK.** `pr_merged` returns *not merged* when the host cannot be asked, so every caller keeps what it was about to remove — *"silence is never permission"*. The adapter answers `unknown` as a payload rather than a failure, deliberately, because *"a host that cannot be asked must not answer `not-merged`"*.

**Those two are opposite by design and must stay so.** The adapter reports what it knows; the shell gate converts *unknown* into *keep*. Routing must not collapse them into one answer — the adapter's three become the gate's two, and the mapping is the slice's central assertion.

**`pr_open` TRAVELS WITH IT.** It vetoes a deletion, so it can only ever keep a ref — safe **only because `pr_merged` already refused on the same silence**. Both move or neither does.

**Done when** `plot-pr-merged.sh` names `gh` zero times, `pr_merged` still answers *not merged* on an unreachable host, `pr_open` still only keeps, and both are asserted by a test.

### The board updater is routed or exempted (Branch: infra/the-project-api-is-named)

`plot-update-board.sh` asks the adapter, or is exempted by name with its reason recorded.

**IT IS CAPABILITY, NOT ROUTING**, and that distinction is #717's own words. Widening `plot-host.sh` with four project operations is a bigger change than moving a call, and it makes the adapter answer for a second GitHub API family with no Bitbucket equivalent.

**THE EXEMPTION IS THE LIKELIER ANSWER AND IT MUST BE WRITTEN DOWN.** `scripts/check-ancestry-decisions.sh` is the model: it carries named exceptions with declarations beside them, so an exception is a decision a reader can find rather than a hole.

**Done when** `plot-update-board.sh` either asks the adapter or carries a named exemption the gate reads, and the reason is in the file.

### The gate refuses the next one (Branch: infra/a-gh-call-declares-itself)

`scripts/check-gh-callers.sh` fails CI when a script outside `plot-host.sh` gains a live `gh` call.

**IT MUST NOT MATCH COMMENTS.** Measured: `plot-budget.sh` and `plot-worker-monitor.sh` mention `gh` in comments only, and `plot-reconcile-scan.sh:1059` prints `inspect: gh pr view …` as advice in its output. A gate flagging those is a gate that gets disabled on its first run.

**THIS IS THE THIRD TIME THE RULE HAS BEEN WRITTEN AS PROSE.** CLAUDE.md states it, `plot-host.sh`'s header states it, #717's brief asserted it. Four scripts violated it anyway.

**Done when** the gate fails on a deliberately added `gh` call, passes on the estate, and ignores comments and output text.

## Notes

### Why the gate is last rather than first — 2026-09-06

It would fail on the two files above the moment it landed. A gate that arrives red teaches the reader to skip it, which is the failure mode this repo has already measured for the scan's own footer.
