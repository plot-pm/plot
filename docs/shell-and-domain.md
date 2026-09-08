# A shell script asks the domain

Plot's rules live in `packages/domain`. Its scripts live in `skills/plot/scripts` and run in bash. This document answers three questions about the seam between them, and no more:

1. **When does a shell script call the domain rather than duplicate it?**
2. **Where does the call go?**
3. **How does a test prove a duplicate agrees?**

It settles the estate's existing practice. `plot-pr-merged.sh` is sourced by four scripts while `rules/reapable.ts` and `rules/queue.ts` answer the same question in TypeScript — *did this land*, the most consequential refusal here, deliberately implemented twice. `plot-approve.sh` pays a `node` hop once per run and holds no copy of the transition rule. Both are correct, and the difference between them is measured rather than preferred.

## 1. When a shell script calls the domain

**The cost rule is a measurement.** Measured 2026-09-07 on this machine: bare `node -e ''` starts in **34 ms**, and a shipped bundle under `skills/plot/scripts/board/` answers in **39 ms**.

| how often the script runs | what it does |
|---|---|
| once per operator command | **calls the domain.** 39 ms against a command a person waited to type is free. |
| once per agent per pass | **duplicates the rule**, and a test holds the pair. |

`plot-approve.sh` and `plot-deliver.sh` are the first case: each pays one hop through `board/plot-transition.mjs`, and `plot-deliver.sh` pays a second through `board/plot-ask.mjs`. `plot-worker-loop.sh` is the second case and is what forced the question — it runs per agent on every pass, and a hop there is paid by every agent forever.

**The boundary is the frequency, not the caller's language and not the rule's importance.** `plot-reap.sh` runs once per sweep and calls `rules/reapable.ts` for the most destructive decision Plot makes. `plot-pr-merged.sh` answers the same class of question and is duplicated, because it is sourced inside loops.

**A rule that cannot be asked refuses.** Where a script calls the domain, `node` missing, an import failing, or the module throwing must leave the script refusing, not proceeding. `plot-reap.sh:451` states it: silence is never permission.

## 2. Where the call goes

There are two seams, and which one applies follows from where the script ships.

**A shipped bundle under `skills/plot/scripts/board/`.** This is the seam for a script that ships in the published npm package, where `packages/` does not exist. `plot-movable.mjs`, `plot-landed.mjs`, `plot-branch-state.mjs`, `plot-task.mjs` and their siblings are each one entry point in `packages/board/src/server/entry/`, bundled by `pnpm build:board`, resolving in both the repo checkout and the published layout.

- **One bundle per question.** `plot-ask.mjs` answers `board` and `fleet` by *running* `plot-fleet-scan.sh`; a dispatcher asking it would be an artifact calling a script that calls the dispatcher. A bundle that spawns nothing gets its own artifact.
- **Tab-separated in, tab-separated out**, where the caller is bash reading one line per subject. A JSON round trip means `jq` per line — a second process to avoid a second format.
- **A new bundle is a new entry point plus a `build.mjs` block**, and the artifact is committed.

**A quoted heredoc importing the rule directly.** This is the seam for a script that runs only inside the plot checkout. `plot-reap.sh` imports `packages/domain/src/rules/reapable.ts` through a path derived from its own `BASH_SOURCE`, never from the cwd: node 24 strips the types, so there is no build step between the script and the decision.

**Never `plot-ask.mjs` for a new rule.** It is the board controller's entry point and it runs the fleet scan. A rule question routed through it buys a scan nobody asked for.

## 3. How a duplicate is held

**Neither side is authoritative. The test says they agree.**

A duplicated rule joins the corpus tier at `packages/domain/corpus/`, which already compares adapters against production over this repository's live estate. A rule-versus-shell comparison is the same shape with a different pair:

> **Read every X on the estate, score it both ways, assert equal.**

The comparison is parameterised over what is read. Production supplies the *readings* and its own *verdict*; the domain rule re-scores the same readings; the two verdicts are compared. Production's parsing is never reused to build the domain's input in a way that could only agree — the readings are the wire's own fields.

**A disagreement names both answers and the subject.**

```
the-scripts-say-slice :: state :: shell=open rule=withdrawn
```

`describeDisagreement` in `corpus/compare.ts` renders this, and one empty-array assertion collects every disagreement rather than failing on the first. One item disagreeing and all 134 disagreeing are different findings pointing at different bugs.

**A known divergence is declared, not skipped.** Where the shell answers a case the domain cannot yet express, the comparison lists those subjects by name with the reason, and asserts the list is exactly what is expected — so the divergence shrinks when the plan that closes it lands, and a *new* one still fails.

**On a disagreement the branch stops.** Which side is wrong is judgement. Adjusting either side to make the comparison pass is the one move forbidden — it is the permissive failure, and it cements a production bug behind a green test.

**A comparison that can only pass proves nothing.** Every rule comparison asserts a floor on its corpus size and asserts that the corpus exercises each answer the rule can give. A universal claim over an empty set is true.

## The first comparison

`corpus/sprint-score.corpus.test.ts` compares `scoreItem` (`entities/sprint.ts`) against `item_state` (`plot-sprint-release.sh`) over every MoSCoW item in every sprint file on the estate — 134 items across 10 sprints, exercising `done`, `open` and `disputed`.

It is the smallest case on purpose: 12 lines of bash, one function. **Proving the contract on the smallest case is the point.**

It already carries a declared divergence. `item_state` takes a third reading the domain does not have — `delivered: "none"`, meaning the item names no plan — and takes such an item at its checkbox. `scoreItem` has no way to say *no plan named*, so it reads the same item as `disputed`. Five items on this estate are in that case. [`a-sprint-item-has-one-scorer`](plans/2026-09-07-a-sprint-item-has-one-scorer.md) is the plan that closes it; until then the five are named in the test.

## The second comparison, and what a constructed corpus is for

`corpus/desk-reset.corpus.test.ts` compares `resetRefusals` (`rules/reapable.ts`) against `desk_reset_refusal` (`plot-worker-loop.sh`) — the decision an agent makes about its own desk, and the loop is the case this document was written for.

**Its corpus is BUILT rather than read, and the difference is not a shortcut.** A sprint item is checked into the repository, so every runner scores the same 134. A desk is not: it is a worktree on a machine, and what holds it is whatever an agent happened to leave there. Measured 2026-09-08 on this estate — 17 desks answering `resettable`, `uncommitted-changes` and `blocked-marker`, never `unpushed-commits`, with the split moving between runs as agents edited files. **CI's checkout has one worktree and it is clean.** A live corpus there would exercise one answer of four, which is the *comparison that can only pass* this document already refuses.

So each state is built in a real repository with a real origin, and read back through the loop's own `plot_worker_blocked` and `plot_worker_dirty`. **The shell under test is the shipped shell; only the estate it reads is made.** The rule stated in section 3 is unchanged — production supplies the readings and its own verdict, and the domain re-scores the same readings.

**Where a subject cannot be checked in, the corpus builds it.** What must never be built is the READING: assembling `dirtyPath` from a `git status` written in the test would compare the domain against the test's idea of a dirty tree, and `plot_worker_dirty` drops editor leftovers and Plot's own `.plot-worker.*` records for measured reasons.
