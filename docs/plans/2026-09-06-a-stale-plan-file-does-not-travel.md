# A stale plan file does not travel

> Two commits this session reverted a plan annotation an agent had written minutes earlier. Both were `git add` over a working tree the fleet had moved under, both restored the exact prior blob, and no gate saw either. The estate takes six plan-file commits in twenty minutes and every one of them is a chance to do it again.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- A commit that reverts a plan annotation it never edited is refused before it is written.

<!-- Board impact: none. The check runs at commit time and writes nothing the
     board reads. -->

## Motivation

**Measured 2026-09-06, twice, four hours apart.**

```
9c871866  11:02  plot: record PR #726 for a-stated-state-parses      writes  PR: #726
3a3efcac  11:50  plot-host: an absent CLI is not a lookup miss       reverts PR: #726
a18414d5  13:43  plot: record PR #734, and restore #726 beside it    repairs it by hand
```

**The blobs prove it was not an edit.** `3a3efcac` left the file at `942fbc1c` — byte-for-byte the blob from `6f581c5b`, the commit *before* the annotation was written. A stale copy overwrote a newer one.

**The second incident, at 13:53, had the same signature and was caught before the push:** three plan files staged in a commit about briefs, each reverting to the blob at `f9c8e151` — my HEAD from 13:34, while agents had pushed `#732`, `#733`, `#734` and `#735` to `origin/main` between 13:35 and 13:52.

**THE MECHANISM IS ORDINARY AND THAT IS THE PROBLEM.** A session holds a checkout. Agents commit to `origin/main` from their own worktrees. The session's tree is never touched, so `git status` reports the plan files as *modified* — they differ from the session's HEAD — and `git add` stages a revert nobody typed.

**THE RATE IS MEASURED.** `origin/main` took six commits to `docs/plans/` in twenty minutes on 2026-09-06, all from agents recording PRs and starts. A session that reads a plan, works for thirty minutes, and stages anything has been overtaken.

**NOTHING SEES IT.** `plot-reconcile-scan.sh` is deliberately blind here, and says why at `:759`: *"Deliberately NOT keyed on the plan's own `prs` field … The missing annotation and the missing delivery share a cause, so an annotation-dependent check is blind to exactly the plans it exists to catch."* That reasoning is right for its question and leaves this one unasked.

**The estate-wide sweep found no standing damage from this cause.** 68 branches on `origin/main` carry a merged PR their plan does not name; **66 are on Released plans**, where `:761` records that annotations were back-filled at delivery, and the 2 live ones — `#685`, `#714` — were never written at all rather than written and lost. Both incidents were repaired by hand within hours. **The defect is live and its damage so far is zero**, which is the argument for a gate rather than against one: what caught both was a person reading a diff.

## What this is not

**Not a fix for concurrent editing.** Two writers to one file is what git is for. What is wrong is a commit that reverts a hunk its author never looked at.

**Not `git pull` before every commit.** A session cannot rebase mid-task on an estate committing every three minutes, and a pull that conflicts in the middle of unrelated work is worse than the revert.

**Not a plan-file lock.** Agents must keep recording their PRs; that is the estate working.

**Not a `git add -A` ban.** The second incident staged `packages/ skills/ .changeset/` by path and the plan files came anyway — they were already in the index from an earlier `git add -A` in the same session. A narrower path does not help once the index holds the stale entry.

## Slices

### A commit does not revert what it did not edit (Branch: bug/a-stale-plan-file-does-not-travel)

A pre-commit gate refuses a commit whose staged content reverts `origin/<main>` for a file the session did not modify.

**THE TEST IS THREE-WAY AND IT IS THE WHOLE RULE.** For each staged file, compare the staged blob against `origin/<main>` and against the session's HEAD:

| staged vs HEAD | staged vs origin | verdict |
|---|---|---|
| same | differs | **refuse** — a stale copy travelling with an unrelated commit |
| differs | differs | allow — a real edit, whoever else has touched the file |
| same | same | allow — nothing to say |

**The refused case is precisely both incidents**: the file was not edited in this session and the staged content is behind the remote.

**IT NEEDS A FETCH AND THAT IS THE COST.** The gate reads `origin/<main>`, so it is only as good as the last fetch. A stale ref makes it silent, never wrong — it can miss a revert, and it can never refuse a legitimate edit. **Failing toward allowing** is the right direction here: this gate sits in front of every commit in the repository, and one that blocks work on a slow network would be turned off within a day.

**WHAT THE MESSAGE MUST SAY IS THE FIX, NOT THE FAULT.** `git checkout origin/main -- <file>` and re-stage. A gate that reports *"staged content is behind origin"* and stops has handed the reader a puzzle at the moment they are least able to solve it.

**IT IS A GATE AND NOT A RULE, BY THIS REPO'S OWN TEST.** *Can you answer "did I complete this?" without doing the work?* — "check whether the fleet moved under you" is answerable **yes** by anyone who did not check, and two commits this session prove it.

**Done when** a commit staging a stale plan file is refused with the repair named, a commit editing the same file is allowed however far the remote has moved, an unfetched or absent `origin/<main>` allows and says it could not verify, and the hook adds no measurable time to a commit of ordinary size.

## Notes

### Why the scan cannot be the place — 2026-09-06

`plot-reconcile-scan.sh` runs on demand over the whole estate and answers *what is drifting now*. This defect is a property of **one commit at the moment it is made**, and by the time a scan runs the annotation is gone with nothing to compare against — the scan would have to know what `origin/main` said before the commit, which is exactly what the commit destroyed.

**The reconcile scan is also the wrong latency.** Both incidents were repaired within four hours *because a person read a diff*. A finding that appears in a scan somebody runs weekly is a finding about work already merged.
