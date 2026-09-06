# A stale plan file does not travel

> Two commits this session reverted a plan annotation written minutes earlier. Neither edited the file: a second Claude session ran `git pull` and `git commit` in the same checkout, and the branch moved under an index that was never refreshed. The reproduction disproved the first explanation, and the real one is two sessions sharing one working directory.

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

**THE FIRST EXPLANATION WAS WRONG AND THE REPRODUCTION DISPROVED IT.** The claim was that agents committing from their own worktrees leave a session's files reading as *modified*. Built in a sandbox — a bare remote, a session clone, an agent clone recording a PR — **it does not happen.** `git status` reports nothing, `git add -A` stages only the session's own file, and a push that would revert is rejected. Git compares the working tree to the local HEAD, and a remote commit moves neither.

**WHAT ACTUALLY HAPPENED IS IN THE BRANCH REFLOG, AND IT IS ONE CHECKOUT.**

```
main@{13:43:07}  pull --ff-only -q origin main: Fast-forward
main@{13:43:37}  commit: plot: record PR #734, and restore #726 beside it
main@{13:53:40}  commit: plot: brief the three slices the tick named no-brief
```

**All three are `refs/heads/main` in the session's own checkout.** Something ran a pull and a commit in this working directory between 13:34 and 13:53 — `git worktree list` confirms `main` is checked out in exactly one place, and no Plot script runs `pull --ff-only` (grepped across `skills/`, `scripts/`, `.plot/`). So a second Claude session was running bash in the same directory.

**THE BLOBS SHOW THE COMMIT CHANGED NOTHING.** `03303dd0` recorded `7830688e` for `a-changeset-names-its-plan.md` — byte-identical to the blob its own HEAD `f9c8e151` already held. The apparent deletion in `git show --stat` is against parent `a18414d5`, which the concurrent session had advanced the branch to. **The file was never edited by anybody; the branch moved under an unrefreshed index.**

**THE RATE IS WHAT MAKES IT REACHABLE.** `origin/main` took six commits to `docs/plans/` in twenty minutes on 2026-09-06. That rate is not itself the defect — a busy remote is harmless to a session that never pulls — but it sets how far a shared checkout drifts between one session's commands and the other's.

**NOTHING SEES IT.** `plot-reconcile-scan.sh` is deliberately blind here, and says why at `:759`: *"Deliberately NOT keyed on the plan's own `prs` field … The missing annotation and the missing delivery share a cause, so an annotation-dependent check is blind to exactly the plans it exists to catch."* That reasoning is right for its question and leaves this one unasked.

**The estate-wide sweep found no standing damage from this cause.** 68 branches on `origin/main` carry a merged PR their plan does not name; **66 are on Released plans**, where `:761` records that annotations were back-filled at delivery, and the 2 live ones — `#685`, `#714` — were never written at all rather than written and lost. Both incidents were repaired by hand within hours. **The defect is live and its damage so far is zero**, which is the argument for a gate rather than against one: what caught both was a person reading a diff.

## What this is not

**Not a fix for concurrent editing.** Two writers to one file is what git is for. What is wrong is a commit that reverts a hunk its author never looked at.

**Not `git pull` before every commit.** A session cannot rebase mid-task on an estate committing every three minutes, and a pull that conflicts in the middle of unrelated work is worse than the revert.

**Not a plan-file lock.** Agents must keep recording their PRs; that is the estate working.

**Not a `git add -A` ban.** Staging by path did not help and neither would a ban: the committed blob was **identical to the committing session's own HEAD**. No `git add` misbehaved. What differed was the parent the commit landed on.

**Not a defect in git.** Two processes committing to one working directory is outside what an index can protect. Git did the correct thing at every step, including rejecting the push that would have reverted the remote.

## Slices

### A commit refuses a checkout that moved under it (Branch: bug/a-stale-plan-file-does-not-travel)

A pre-commit gate refuses a commit whose `HEAD` has moved since the index was last refreshed against it.

**THE THREE-WAY BLOB TEST WAS DRAFTED FIRST AND IT WOULD NOT HAVE CAUGHT THIS.** It compared staged content against `origin/<main>` and against `HEAD`, refusing *staged same as HEAD, differs from origin*. But the committed blob `7830688e` **was** its session's HEAD, and `git show --stat` only showed a deletion because the branch had been advanced to `a18414d5` underneath. A rule about content cannot see a defect about parentage.

**WHAT THE GATE MUST COMPARE IS THE REF, NOT THE FILE.** Record the `HEAD` sha a session last observed; before a commit, refuse when `HEAD` differs and the session did not move it. That is the one fact both incidents share and the only one that separates them from ordinary work.

**IT IS A HOOK IN THE SESSION, NOT IN THE REPOSITORY.** A `pre-commit` hook cannot tell which session advanced the branch — both are `git` in the same directory with the same credentials. The state that distinguishes them belongs to the session, so this is a wrapper around the session's own commits, not a repository-side gate.

**AND THE CHEAPER FIX MAY BE THE RIGHT ONE.** Two Claude sessions sharing one working directory is a configuration, not a law. A second session working in its own worktree — which is what every dispatched agent already does — removes the defect entirely and costs nothing. **This slice should establish that first**, and build the gate only if shared checkouts must stay supported.

**Done when** the estate has a stated answer to whether two sessions may share a checkout, and — if they may — a commit against a branch the session did not advance is refused with the repair named.

## Notes

### Why the scan cannot be the place — 2026-09-06

`plot-reconcile-scan.sh` runs on demand over the whole estate and answers *what is drifting now*. This defect is a property of **one commit at the moment it is made**, and by the time a scan runs the annotation is gone with nothing to compare against — the scan would have to know what `origin/main` said before the commit, which is exactly what the commit destroyed.

**The reconcile scan is also the wrong latency.** Both incidents were repaired within four hours *because a person read a diff*. A finding that appears in a scan somebody runs weekly is a finding about work already merged.

### The first explanation was wrong, and the reproduction is why — 2026-09-06

This plan first claimed that agents committing from their own worktrees leave a session's plan files reading as *modified*, so `git add` stages a revert. It was argued from blob forensics and it was wrong.

**A sandbox settled it in four commands** — a bare remote, a session clone, an agent clone recording `PR: #726`, then `git status` in the session. Nothing modified, nothing staged, and a push that would revert rejected outright. Git compares the working tree to the local HEAD, and a commit on a remote moves neither.

**The forensics were right about the blobs and wrong about the cause.** Every observation held — the exact prior blob, the byte-identical revert — and they were all consistent with a second explanation nobody had looked for, because nobody had checked which checkout the writes came from.

**`git reflog show main` was the answer and it took one command.** Two hours of blob comparison against a branch reflog that names the pull, the commit, and the time.
