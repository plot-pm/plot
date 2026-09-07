PLOT-BLOCKED: This slice waits on `feature/the-build-port-exists`, which has not landed — it has no PR, is not on `main`, and another agent is editing it right now. Should I wait, or do you want me to build on the unmerged branch?

## What the brief says

> **Waits on:** `feature/the-build-port-exists` — do not start before it lands. The plan says why.
> **AND READ WHAT YOU WAIT ON.** This slice was ordered behind `feature/the-build-port-exists` for a stated reason — a contract it needs, or a shape it should not invent twice. **Its PR is the input to yours.**

The plan's slice section says the same thing in one line:

> **IT WAITS FOR THE PORT.** No connector before the seam exists.

## What I measured, 2026-09-08 01:05

| fact | reading |
|---|---|
| `packages/domain/src/ports/build.ts` on `origin/main` | **absent** |
| `packages/domain/src/adapters/build/` on `origin/main` | **absent** |
| `origin/feature/the-build-port-exists` | exists, 2 commits ahead of main, 18 files, +1198/-158 |
| its PR | **none** — `pr-list --state all` matches no PR for that head |
| its last commit | `bbdf6569`, **2026-09-08 00:44:42**, ~20 minutes before I looked |
| its worktree | `/Users/jwloka/Quatico/Agentic-Tools/plot/.worktrees/free-05f7d230`, checked out at that commit |

So the dependency is **implemented and pushed, but unlanded, unreviewed, and actively being worked**.

## Why I did not start anyway

The seam I need is real and I can see it — `build-resolve.ts:buildFor()` on that branch even names my slice:

> `jenkins` HAS NO CONNECTOR YET and therefore resolves to none, which is the honest answer while `build-jenkins.ts` does not exist. **It is the next slice's one line here.**

I could branch from `origin/feature/the-build-port-exists` and add `build-jenkins.ts` plus that one `case`. I did not, for three reasons:

1. **My PR would carry its diff.** Basing on an unmerged branch puts 18 files and 1198 lines I did not write into my PR, and a reviewer cannot tell my slice from the one it waits on. The plan splits these into separate branches with separate PRs precisely so each is reviewed on its own.
2. **Its shape is not settled.** It has no PR, so nothing has been reviewed. It already diverges from the plan in ways review may revisit — the plan names `build-actions.ts` and `build-jenkins.ts` as the two connectors, and the branch ships `build-actions.ts` over a shared `build-shell.ts` reader, plus a fourth port operation (`system()`) and a fifth (`lastRefusal()`) that the plan's "THREE OPERATIONS ... Do not invent a fourth" does not mention. If review changes `buildReads`' signature, my connector is rewritten.
3. **Another agent holds it.** It was committed 20 minutes ago. Building on a branch someone is editing means rebasing onto a moving target, and my worktree cannot see their uncommitted work.

## What I need from you

**Option A — wait (my recommendation).** Re-dispatch this branch once `feature/the-build-port-exists` merges to `main`. The work is then genuinely small: a `build-jenkins.ts` beside `build-actions.ts`, one `case 'jenkins':` in `buildFor`, and its tests. Nothing is lost by waiting; the annotation did its job.

**Option B — chain the branches.** If you want this in the same wave, say so and I will branch `feature/the-ci-connector-is-jenkins` from `origin/feature/the-build-port-exists` rather than `main`, and open my PR against **that** branch instead of `main` — so each PR still shows only its own slice. This needs your decision because it changes the PR target the brief specifies ("Ends as: one PR to `main`").

## What I found that the plan did not anticipate

Worth recording either way, because it changes how small this slice is:

- **`plot-host.sh` already has substantial Jenkins machinery, and `ci-limit` already answers `predicted` for it.** Line 3056: `{"connector":"jenkins", ..., "basis":"predicted"}`. The plan's done-when clause *"`limit()` reports `predicted`"* is **already satisfied at the shell** — the connector only has to not break it.
- **`jenkins_build_map()` (line 546) already drives `jen`** — `jen -I <slug> auth status`, then `jen -I <slug> job list <job> --json`, with percent-decoding and a colour→checks table. It is reached from `pr-list --rich`, not from `runs`. So a Jenkins `runs` arm has a working precedent to follow rather than a blank page.
- **`runs` and `run-for-sha` gate on `$be = github`, the GIT HOST, not on the CI system.** `build-actions.ts` on the waiting branch names this as an inherited limit it deliberately does not fix: *"on a repository whose code is not on GitHub they print nothing."* **So a `build-jenkins.ts` that only shells to the existing ops answers empty for every Jenkins repo** — the connector cannot meet its done-when (*"an unreachable Jenkins refuses rather than returning an empty list"*) without a `jenkins` arm being added to those two script ops. That is shell work this slice's description does not mention, and it is the substance of the slice rather than a detail.
- **`jen` is not installed here**, which the plan already anticipated and answered: stub the script the way `tracker-shell.test.ts:78` stubs `plot-host.sh`, and state in the PR what a real instance was never asked.
