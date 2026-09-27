# A correction is not unlanded work

> The reaper refuses a desk whose only uncommitted file is a `PLOT-CORRECTION.md` — the file an operator writes to help the agent. So **helping an agent prevents its desk being reaped**, and a desk whose work has merged can need three manual acts to clean up.

## Status

- **State:** Approved
- **Approved:** 2026-09-27, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1024
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1

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

### Two filter sites, and the slice must cover both

`plot-reap.sh` carries the exclusion snippet **twice, independently**:

```
522:  | grep -v 'tiny-garden/\.plot/state' | head -1)      # the reap reading
1036: | grep -v 'tiny-garden/\.plot/state' | wc -l ...)     # the dirty sweep
```

The comment at `:511-518` argues the identical case for the fixture it excludes — *"it is filtered HERE, in the reading, because it is a fact about this repository's fixtures and not about whether a worktree may go"* — which settles the layering question this plan asks: **one `grep -v` in the reading, not a rule change.**

**Excluding the correction at `:522` alone leaves the defect half-fixed.** The sweep at `:1036` would go on counting the desk in `dirty_trees=` and printing it under *"dirty trees nobody owns"* — a finding about a file the reaper just decided does not count. Both sites or neither.

### The tooling-state file is TRACKED, so `.gitignore` cannot fix it

```
$ git ls-files | grep .omc
packages/board/.omc/state/last-tool-error.json
$ grep -n omc .gitignore
18:.omc/
```

`.omc/` is already ignored and the file is still reported, because an ignore rule does not apply to a tracked path — which is why it shows as ` M` rather than `??`. **The answer to "consider `.gitignore` first" is therefore no**: the options are `git rm --cached` or the named exclusion. A slice that adds an ignore rule will observe no change.

The estate has hit this once already: the merge that shipped #1018 carries *"board: leave the tool-error state file to whatever wrote it — swept into this branch by a `git add -A`. It is agent tooling state, tracked on main."*

### Anchor the match

`PLOT-CORRECTION.md` at a desk root is `?? PLOT-CORRECTION.md`, and the existing exclusions are whole-line `grep -v`. A pattern anchored loosely would also match `docs/PLOT-CORRECTION.md` or any path containing the name. **The plan's "closed and named, never a pattern" rule extends to anchoring**, since the whole safety argument is that no source file can be caught.

## Done when

- A desk whose only uncommitted file is `PLOT-CORRECTION.md` is reaped, given its other conditions pass.
- A desk with any other uncommitted file is still kept, and the refusal still names the path.
- A `PLOT-BLOCKED*` marker still refuses.
- The tooling-state path is either ignored by git or named, with the choice argued.
- **Both** reading sites exclude it — the reap reading at `:522` and the dirty sweep at `:1036` — asserted by a test that drives the sweep's counter as well as the reap decision.
- The match is anchored to the desk root, and a test proves `docs/PLOT-CORRECTION.md` is still reported.
- The tooling-state file is resolved by `git rm --cached` or a named exclusion, never by an ignore rule.

## Slices

### A correction is not unlanded work (Branch: bug/a-correction-is-not-unlanded-work)

The named exclusion, the `.gitignore` decision for tooling state, and tests for all four cases above.

## Notes

Measured across one session: **2 desks reaped automatically, 1 removed by hand, 2 more needed files cleared first.** Every one of the five had a merged PR — finished work that the fleet could not clean up after itself, because an operator had tried to help.

**Round 1 (2026-09-27): the evidence lens committed `proceed` having executed.** It confirmed the premise most likely to be false — `git check-ignore PLOT-CORRECTION.md` exits 1, so the file is not ignored and the reaper does see it — and reproduced the refusal in a scratch repository. Three findings were folded in above rather than left to the slice: the **second filter site** at `:1036`, which the first draft did not mention and a slice would have missed; that the tooling-state file is **tracked**, so the `.gitignore` option the plan offered is a no-op; and that the match needs **anchoring**, since the existing exclusions are whole-line greps.

It also found the precedent the first draft did not cite: `plot-reap.sh:511-518` already argues this exact case for the `tiny-garden` fixture, which settles the layering question in the plan's favour.

Verdict and full reading: `.plot/panels/2026-09-27-a-correction-is-not-unlanded-work/evidence.md`.
