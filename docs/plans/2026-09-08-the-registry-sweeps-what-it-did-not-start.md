# The registry sweeps what it did not start

> Twelve worktrees accumulated in `/private/tmp` over one session, none of them dispatched. The fleet scan walks every registered worktree, so 34 entries where 22 were real pushed it past its 90-second bound and the board fell back to a stale pulse.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-08, Jan Wloka, in-session
- **Started:** 2026-09-09, Jan Wloka, `bug/the-registry-sweeps-what-it-did-not-start`
- **Delivered:** 2026-09-09

## Changelog

- The supervisor reports worktrees nobody dispatched, so hand-made trees cannot accumulate until a scan times out.

<!-- Board impact: directly. A timed-out scan is what the board renders as
     "showing the last successful pulse below". -->

## Motivation

**Measured 2026-09-08.** `git worktree list` reported **34** entries; `.worktrees/` held 21 and one more sat beside the checkout. The other **twelve were in `/private/tmp`**, created by hand during one session to resolve merge conflicts — `git worktree add --detach /tmp/wt818 origin/feature/…` — and never removed.

**The scan walks every registered worktree**, so it was doing 55% more work than the estate required. At load 50 that crossed its bound:

> *"Last scan failed: timed out after 90000ms — 34 worktrees, 9 branches — showing the last successful pulse below."*

**The board was right and looked wrong.** It reported exactly what happened and fell back to the last good reading; a person reading it saw a number they could not account for. After removing the twelve the scan finished in **53.3 s**.

**NOTHING WAS GOING TO CLEAN THEM UP, AND THAT IS CORRECT AS FAR AS IT GOES.** `plot-reap.sh` removes a dispatch worktree whose work has landed, on five measurements. These had no claim, no manifest and no registry entry — the reaper never knew they existed, and a reaper that deleted directories it did not create would be a different and much more dangerous tool.

**BUT THE COST LANDS ON THE FLEET, NOT ON WHOEVER MADE THEM.** Every registered worktree is walked by every scan, on every pulse, forever. A tree nobody dispatched still slows the estate down — and the person who made it is not the person reading the board an hour later.

**THE PORT CANNOT SEE THEM EITHER, AND THAT IS THE DEEPER GAP.** `ports/trees.ts` asks every question by BRANCH — `forBranch`, `presence(branch)`, `cleanliness(branch)`. A worktree cut with `--detach` has no branch, so no caller can name it. `presence` already knows the shape of this problem: it reports `vanished` for an entry whose directory is gone, measured at 3 of 20 on 2026-09-06. **A tree that is present but unclaimed is the case with no reading at all.**

## What this is not

**Not automatic deletion.** A hand-made worktree may hold work in progress, and the estate's rule for that is settled: the reaper refuses on uncommitted changes, and this must not be laxer than the tool that owns removal.

**Not a ban on hand-made worktrees.** They are the right tool for a merge conflict, and the twelve measured here each did their job. What is missing is that they were invisible afterwards.

**Not a change to the reaper's licence.** It removes dispatch checkouts because every one is re-creatable with `git worktree add`. That argument does not transfer to a directory it never made, so this reports rather than removes.

## Slices

### The supervisor counts the trees it did not start (Branch: bug/the-registry-sweeps-what-it-did-not-start → #845)

The tick reports registered worktrees that hold no claim, and names what a person can do about each.

**IT REPORTS AND DOES NOT REMOVE**, for the same reason the reaper refuses on a dirty tree: the supervisor cannot know why a directory exists. What it can say is that the estate is carrying it — and that the carrying is what costs.

**THE READING IS THE REGISTRATION, NOT THE DIRECTORY.** `git worktree list --porcelain` is the one authority, and it already reports `detached` and `prunable`. A tree is unclaimed when the registry names no agent for it and no plan names its branch — and the HEAD shape says nothing about either. **The clause that read *a detached tree can never be claimed, so it is unclaimed by construction* was measured false and is removed, 2026-09-09:** two of six registered agents on this estate held a DETACHED desk, because `plot-dispatch.sh --start` cuts a free agent's tree detached at `origin/<main>` on purpose. Deriving the claim from the HEAD would have named both of them leftovers while their workers ran.

**IT SAYS WHAT EACH COSTS.** *"12 worktrees nobody dispatched — the scan walks all of them"* is actionable where *"12 unclaimed worktrees"* is trivia. The number the reader needs is the one that connects the finding to the timeout they just saw.

**AND A DIRTY ONE IS NAMED DIFFERENTLY FROM A CLEAN ONE.** A clean unclaimed tree is safe to remove and the report says so with the command; one holding uncommitted work is a finding a person must read before touching. Same split the reaper already draws.

**Done when** a tick names registered worktrees that hold no claim, distinguishes clean from dirty, states the scan cost they add, prints the removal command for the clean ones, removes nothing, and reports zero on an estate where every worktree is dispatched.

### A tree can be asked about without a branch (Branch: feature/a-tree-is-asked-about-by-path) <!-- waits: bug/the-registry-sweeps-what-it-did-not-start -->

`ports/trees.ts` gains a way to enumerate worktrees rather than only to look one up by branch.

**IT WAITS FOR THE FINDING ABOVE**, which can be built on the shell's own `git worktree list` and proves the reading is worth having before the port grows an operation.

**EVERY QUESTION TODAY STARTS FROM A BRANCH**, and the twelve measured here had none. `forBranch`, `presence` and `cleanliness` all take one, so a detached tree is unaskable — not `unknown`, which would be an answer, but unreachable.

**Done when** the port can list every registered worktree with its path, its branch or `detached`, and its prunable state; existing callers are unchanged; and the finding above reads the port rather than the shell.

## Notes

### Why this is filed against the fleet rather than against the operator — 2026-09-08

The twelve were mine, made during one session and left behind twelve times. The obvious lesson is *remove your worktrees*, and it is a rule: an instruction somebody follows until they are busy.

**The estate already knows what to do with that.** *Can you answer "did I complete this?" without doing the work?* For worktree cleanup, yes — which is why it kept not happening. The finding costs one `git worktree list` per tick, on a reading the supervisor is already taking.
