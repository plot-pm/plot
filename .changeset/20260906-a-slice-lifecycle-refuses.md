---
'@plot-pm/board': minor
---

The slice's lifecycle is a domain rule that refuses illegal transitions, joining the story's (#707), the agent's (#710) and the worktree's (#716). `transitions/slice.ts` transcribes `diagrams/slice-lifecycle.mmd` — `unapproved -> blocked -> eligible -> complete` — and refuses anything the diagram does not draw. `unapproved -> eligible` stays, because the diagram draws it: a one-slice plan reaches it on every approval, having no prior slice to wait for. A slice's verdict is derived, so its `Decision` carries a verdict rather than a write; `DESIGN-slice.md` §9 records that there is *"no writer, no cache, no record."*

**A prerequisite that merged and was then reaped still clears.** `plot-release-refs.sh` deletes the remote refs of a delivered plan's merged branches, so a prerequisite that completed eventually has no ref — and a rule reading refs would hold its dependent forever because its dependency succeeded. That deadlock was found while writing `a-slice-can-wait-on-another-plan` and fixed by correcting the plan; until now it lived in prose. It is now enforced by the type: `PrerequisiteReading` carries the branch name and what the host said about its pull requests, and nothing about a ref, so a caller holding refs has nothing to pass and a ref-reading rule cannot be written against it. `none` and `unreachable` stay apart, because a typo resolves by editing the plan and silence resolves by asking again.

`SliceVerdictSchema` moves from `classification` to `lifecycle slice`. It was declared a classification on the reasoning that *"the slice's own lifecycle is its branch's"*, and `DESIGN-slice.md` §4 corrects exactly that: an earlier draft of the spec called the verdict a reading and was overruled — *"the verdict is what the board tracks a slice's progress by … functionally it is the slice's state."* Derived every pulse and stored nowhere is a statement about who writes it, not about whether it moves. `BranchStateSchema` keeps its own declaration and no longer claims the slice's.

The rule takes the verdict as a reading and never rebuilds it from a branch count, so `the-slice-contract-says-what-it-reads` can correct `rules/eligible.ts:80` — which answers `complete` for a slice with no branches at all — without moving a refusal here.

33 tests, one per refusal, each verified to fail against a real violation rather than to pass on the day it was written. Five mutants of the source, each caught: the prerequisite read from a ref instead of the host (2 failures), every move allowed (9), the ordering gate dropped (4), an unreachable host treated as permission (1), `none` and `unreachable` collapsed (2).

<!--
bumps:
  skills:
    plot: patch
-->
