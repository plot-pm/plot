# A correction is not unlanded work

> The reaper refuses a desk whose only uncommitted file is a `PLOT-CORRECTION.md` — the file an operator writes to help the agent. So **helping an agent prevents its desk being reaped**, and a desk whose work has merged can need three manual acts to clean up.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1024
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 0

## Changelog

- A correction file and tooling state stop counting as unlanded work. A desk whose PR merged is reaped without an operator deleting files first.

Board impact: none. Fewer desks linger; nothing renders differently.

## Motivation

### Measured 2026-09-27

```
keep  bug/a-branch-behind-main-holds-nothing   uncommitted: ?? PLOT-CORRECTION.md
keep  bug/a-dispatch-does-not-hold-the-loop    uncommitted:  M packages/board/.omc/state/last-tool-error.json
```

**Both branches had merged PRs.** The uncommitted files were an operator's own correction — consumed by the agent and worthless afterwards — and a tooling state file no plan touches. Deleting both made the same reaper reap both immediately.

### Why the refusal is right in general and wrong here

`reapable.ts` refuses on `uncommittedChanges` because uncommitted work is **the one thing a removed worktree cannot get back**. Its own comment: *"uncommitted work exists in exactly one place."*

That is correct for source files. It is not correct for a file the estate itself writes with a known lifetime:

- **`PLOT-CORRECTION.md`** is written by `plot-worker-loop.sh:605` (`write_correction`), read by the agent, and has no value once read. The loop already treats it as distinct from a `PLOT-BLOCKED*` marker — *"a correction owes a person nothing."*
- **`packages/board/.omc/state/*`** is tooling state, not work.

### The perverse consequence

An operator who writes a correction to unblock an agent makes that agent's desk unreapable. **The more help given, the more desks need hand-clearing** — measured five times in one session, each needing `rm` before the reaper would act.

### It composes with two other refusals

A merged desk on 2026-09-27 required: delete the correction file, restore the tooling file, then `git worktree remove --force` because the desk had also lost its pid file and read as `unknown` (section 21). **Three manual acts to clean up finished work.**

The pid-file half is `one-answer-to-is-a-worker-running` (#1015). This plan is the other two.

## Design

### The rule

**A path the estate writes with a known lifetime does not count as unlanded work.**

`PLOT-CORRECTION.md` is recognised the way `PLOT-BLOCKED*` already is — as a known marker rather than as a change — and reaches the opposite conclusion, because a correction owes nobody an answer once read.

### The list is closed and named, never a pattern

**A glob would be the defect reversed.** `uncommittedChanges` exists to protect work, and a pattern that happened to match a source file would remove it silently. The slice names each path explicitly and justifies each.

Two candidates today: `PLOT-CORRECTION.md`, and the `.omc/state` tooling path — whose better fix may be `.gitignore`, which the slice should consider first, since a file git never reports is a file the reaper never sees.

### The blocked marker is untouched

`PLOT-BLOCKED*` keeps its own refusal. A desk that asked a person a question must not be removed before the person answers — that is a different lifetime and the opposite conclusion.

### What this does NOT do

- **It does not weaken `uncommittedChanges` for anything else.** One named file, and possibly one ignored path.
- **It does not change the reaper's other four refusals.**
- **It does not fix the pid-less desk.** That is #1015.
- **It does not delete correction files.** The reaper stops counting them; whether a removed worktree takes one with it is already answered by removing the worktree.

## Done when

- A desk whose only uncommitted file is `PLOT-CORRECTION.md` is reaped, given its other conditions pass.
- A desk with any other uncommitted file is still kept, and the refusal still names the path.
- A `PLOT-BLOCKED*` marker still refuses.
- The tooling-state path is either ignored by git or named, with the choice argued.

## Slices

### A correction is not unlanded work (Branch: `bug/a-correction-is-not-unlanded-work`)

The named exclusion, the `.gitignore` decision for tooling state, and tests for all four cases above.

## Notes

Measured across one session: **2 desks reaped automatically, 1 removed by hand, 2 more needed files cleared first.** Every one of the five had a merged PR — finished work that the fleet could not clean up after itself, because an operator had tried to help.
