# A desk is adopted and swept

> `plot-init` never proposes `Worktree root`, so an adopting repository dispatches agents into a layout it did not choose and a `.gitignore` it does not have. And the reaper reads five measurements about a desk, none of which is git's own answer that the directory is gone.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-06, Jan Wloka, in-session
- **Rounds:** 3
- **Started:** 2026-09-06, Jan Wloka, `feature/adoption-proposes-a-worktree-root`
- **Started:** 2026-09-07, Jan Wloka, `bug/the-reaper-reads-prunable`

## Changelog

- Adoption proposes where desks live and ignores them, and the reaper reads git's own answer about a tree whose directory is gone.

<!-- Board impact: the board lists worktrees; a pruned entry is one it stops
     showing. No plan-format change. -->

## Motivation

**`DESIGN-worktree.md` asks three questions and two are about the desk's edges — how one arrives, and how one leaves.**

**ADOPTION NEVER MENTIONS WHERE DESKS GO.** Measured 2026-09-06: `skills/plot-init/SKILL.md` names `Worktree root` **zero times**. The key defaults to `.worktrees`, which is the intended layout — and an adopting repository gets it without being told, without the `.gitignore` line, and without a chance to choose otherwise.

**THIS REPO'S OWN `.gitignore` CARRIES THE LINE AND A COMMENT EXPLAINING IT**, at `:20-23` — *"The dispatch worktrees, gathered here by the `Worktree root` key"*. Every adopter needs the same line and nothing writes it. A dispatched agent's desk is untracked work in the repository root until somebody notices.

**THE DOMAIN ALREADY PARSES `prunable` AND THROWS IT AWAY.** Checked 2026-09-06: `adapters/trees/trees-git.ts` reads it from `git worktree list --porcelain` at `:23`, `:33` and `:41` — and **no port and no rule receives it**. `ports/trees.ts` does not carry the field; `rules/reapable.ts` never sees it.

**So the reading exists twice and reaches nothing.** The adapter parses it and drops it on the floor; the shell scan parses it again for itself. Whatever this slice does, it does not add a reading — it connects one that is already taken.

**THE REAPER DOES NOT READ `prunable`, AND THE SCAN DOES.** `plot-fleet-scan.sh:1312` skips prunable entries with a stated reason: *"A worktree directory can be deleted without git knowing"*. `plot-reap.sh` and `plot-reconcile-scan.sh` mention it **zero times** between them.

**Measured on this estate the same day: 3 of 20 worktrees were prunable** — directories that no longer exist, still listed by git, invisible to the reaper's five refusals because every one of them measures something *in* a tree that is not there.

## What this is not

**Not a change to the five refusals.** A live pid, uncommitted changes, a `PLOT-BLOCKED` marker, a default-branch checkout, no merged PR — each is a measurement and each stays. `prunable` is a sixth reading, and it is the one that says *there is nothing here to measure*.

**Not a `git worktree prune` on a timer.** Pruning is a write, and the reaper's whole discipline is that it refuses on measurements rather than acting on judgement. A prunable entry is reported; whether to prune is the same decision as whether to reap.

**Not a forced layout.** `Worktree root` is proposed, and `plot-init`'s own rule is *"propose, don't interrogate"* — a repository that wants desks elsewhere says so, and the `.gitignore` line follows whatever it chose.

## Slices

### Adoption says where desks live (Branch: feature/adoption-proposes-a-worktree-root, PR: #729)

`plot-init` proposes `Worktree root: .worktrees` and writes the matching `.gitignore` line.

**IT IS A PROPOSAL, LIKE EVERY OTHER FIELD ADOPTION WRITES.** `plot-detect-repo.sh`'s output is *"a proposal a human confirms"*, and this joins it. A repo that already has a worktree convention keeps it.

**THE `.gitignore` LINE IS THE HALF THAT CANNOT BE SKIPPED.** A configured root with no ignore rule turns every dispatched desk into untracked files in `git status`, and the operator's next `git add -A` stages a whole checkout. This repo's own comment at `.gitignore:20` is the wording to copy.

**AND ADOPTION WRITES IT, WHICH IS A FILE `plot-init` HAS NEVER TOUCHED.** Measured 2026-09-06: the skill names `.gitignore` **zero times** — it writes config, a plan skeleton and templates, and nothing else. So this is not one more line in a file adoption already owns; it is a new write surface, and worth saying plainly.

**It is written on confirmation, like everything else adoption creates.** A directory and a plan skeleton are larger commitments than one ignore line, and both are written today. Printing the line for a human to paste is how a repository ends up with desks as untracked files — which is the defect, not the fix.

**AND THE DESK'S OWN IGNORE IS SEPARATE.** `.git/info/exclude` protects a desk cut from an older branch, because a rule in branch content is invisible there. Adoption writes the repo's line; the desk's is `plot-dispatch.sh`'s, and this slice does not move it.

**Done when** `/plot-init` proposes `Worktree root` with its default, writes the `.gitignore` line on confirmation, and changes nothing in a repo that declines.

### A vanished desk is not a desk (Branch: bug/the-reaper-reads-prunable, PR: #759)

`plot-reap.sh` reads git's `prunable` and reports a tree whose directory is gone.

**GIT ALREADY KNOWS, AND ONE COMPONENT ALREADY ASKS.** `plot-fleet-scan.sh:1366` parses the porcelain output and skips prunable entries for a reason it states: a directory can be deleted without git knowing. The reaper asks five questions about a tree and each assumes the tree exists.

**IT IS A REPORT, NOT A SIXTH REFUSAL.** The other five say *do not remove this*; `prunable` says *there is nothing to remove and the entry is stale*. Those are different sentences and the output must not blur them.

**IT WAITS FOR [`a-desk-is-finished-with-once`](2026-09-05-a-desk-is-finished-with-once.md) (#705).** That plan unifies the reaper's five refusals with the ref-deleter's five guards, which are two implementations of one question — and measured 2026-09-06, each is blind to a guard the other applies: `plot-release-refs.sh` never asks about a live pid, `plot-reap.sh` never asks `pr_open`.

**Adding a sixth reading to one script while the other holds a divergent copy means writing it twice, or writing it once and widening the gap.** So the unification lands first and `prunable` joins one rule rather than one of two.

**AND THE READING TRAVELS THROUGH THE PORT IT ALREADY HAS.** `trees-git.ts` parses `prunable` today and no port carries it; the field joins `ports/trees.ts` so `rules/reapable.ts` can be handed it, rather than the reaper growing a sixth `git` call of its own.

**Done when** the reaper names a prunable entry, `ports/trees.ts` carries the field the adapter already parses, nothing is pruned, and the five refusals are unchanged.

## Notes

### The third question is left open — 2026-09-06

*"Should a worktree be monitored?"* The doc says *"nothing watches one, and job 2's answer lives there"*. That is the AgentMonitor's subject — it already watches the desk — and whether a *worktree* needs its own monitor separate from the agent sitting at it is a question `DESIGN-process.md` §8 touches from the other side, where three per-agent monitors become one. It is not answered here because answering it would decide part of `one-monitor-watches-the-slice`, which is an approved slice of another plan.
