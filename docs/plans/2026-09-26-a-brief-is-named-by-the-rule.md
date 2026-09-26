# A brief is named by the rule

> **Twenty-five briefs** have been written under `<prefix>-<slug>.md`, a name no reader computes, across **21 commits from 2026-08-24 to 2026-09-26** — 4.7% of every brief ever added, and accelerating: 7 in August, 18 in September. The registry holds each such slice on `no-brief` while the file sits in place, correct and committed. **No code wrote them.** `brief-path.ts` and the shell helper both compute the right name and a test proves they agree; a master agent types the filename by hand.

## Status

- **State:** Approved
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1013
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)

## Changelog

- A hand-written brief under a name no reader computes is refused at the commit, naming the path the rule gives. A slice stops being held on `no-brief` by a file that is present and unreadable.

Board impact: none. No scan change, no payload field.

## Motivation

**Both readers are correct and neither is the problem.**

`brief-path.ts` states the rule and the failure it prevents, in its own docstring:

> The prefix is dropped rather than flattened. `feature/a-brief-has-one-name` gives `.plot/briefs/a-brief-has-one-name.md`, never `feature-a-brief-has-one-name.md` — **a flattened name is a file no reader computes, so a brief written that way is invisible to the dispatch gate and the branch reads as having none.**

`plot-dispatch.sh:501` holds the same rule as `${1##*/}`, and `test/reconcile/briefpath.test.mjs` asserts the two agree. **So the defect the docstring describes happened twelve times while both implementations were right and tested.**

### The writer is a person, not a component

`git log --diff-filter=A` on the misnamed files names commits like:

```
60df5c958  plot: start a-free-desk-is-nobodys
f1fabaf2a  plot: approve three plans and write the two dispatchable briefs
```

A master agent wrote them, guessing the filename from the branch and flattening the slash. No code path produced these names, which is why grepping for a broken writer finds nothing.

### It is 25, not 12, and the rate is rising

An earlier draft counted what survives on `main` today — twelve. **The history holds twenty-five, across twenty-one distinct commits**, the difference being briefs since renamed, deleted, or carried off on merged branches:

```
$ git log --all --diff-filter=A --name-only --format='' -- '.plot/briefs/*' \
    | grep -E '^\.plot/briefs/(feature|bug|infra|docs|idea)-' | sort -u | wc -l
25
```

Against **530 briefs ever added — 4.7%** — and by month: **7 in August, 18 in September.**

**That changes what this plan is arguing.** Twelve survivors from two commits reads as an occasional slip. Twenty-five from twenty-one commits, accelerating as fleet volume rises, is a systematic failure that prose has already had a month to correct and has not. A convention that degrades under load is the case for a gate, not for a reminder.

### It is the estate's own recorded failure mode

CLAUDE.md's *The Master Agent Uses The Controllers* names this class exactly:

> **This binds the master agent specifically**, because a dispatched worker's changes are reviewed as code and a master agent's hand edits are not. Every mistake above was invisible to review: no diff of a script, no test, no PR.

A brief is a markdown file in a commit nobody reviews. The same section's answer was `plot-state-gate.sh` — a gate, because *"an editor on a markdown line invokes nothing."*

### What it cost, measured 2026-09-26

One dispatch reported `handed=0 … no-brief=1` with three agents idle. The brief was 73 lines, committed, on `origin/main`, correct in content. Renaming it to the computed form and ticking again gave `handed=1 … no-brief=0`, and an agent took the slice on that tick.

**The hold is reported honestly and the file is visibly present**, so the natural check — *does a brief exist for this slice?* — answers yes. Diagnosis took a full dispatch cycle plus four supervisor ticks.

## Design

### The rule

**A commit that adds or renames a file under `.plot/briefs/` is refused when the name is not the one `brief-path.ts` computes for some branch.**

A `PreToolUse` gate beside `plot-phase-gate.sh` and `plot-state-gate.sh`, registered by `plot-install-hooks.sh` like the others.

### Why a gate and not a rule

Gates over rules, and this is the test CLAUDE.md gives: *"Can you answer 'Did I complete this?' without actually doing the work?"* A brief's name can be answered *yes, I named it correctly* by an agent that flattened the slash — which is what happened twelve times.

**It is also the only enforcement point that exists.** The readers cannot refuse: by the time a reader looks, the file is committed and the reader's honest answer is *there is no brief*. Only the commit sees both the file and its name.

### What the gate can and cannot know

**It cannot know the branch set.** A brief may legitimately be written for a branch that does not exist yet — that is the normal case, since briefs precede dispatch.

So the check is **shape, not membership**: a name containing no `/` is required (they all are, being filenames), and a name whose leading segment matches a configured branch prefix followed by `-` is refused, because `brief_path` can never produce one. `Branch prefixes` is already a `## Plot Config` key.

**That is a narrow test and deliberately so.** It refuses exactly the shape observed twelve times and nothing else; a brief named anything not starting with a known prefix passes untouched.

### The gate is reachable, and that is measured rather than assumed

A juror built the prototype — hook JSON on stdin, act only on `git commit`, read `git diff --cached --name-status -M` — and ran it:

```
add    .plot/briefs/another-good-one.md            → exit 0   allowed
add    .plot/briefs/bug-the-thing-broke.md         → exit 2   refused, names the expected path
git mv a-good-name.md → feature-a-good-name.md     → exit 2   refused
```

**A `git mv` is visible**: the rename reaches the staged index as `R100 <old> <new>`, `-M` surfaces it, and the destination path is what the check reads. The plan's *"adds or renames"* wording is mechanically achievable.

**The route is the one the existing gates use.** `plot-state-gate.sh:57` takes `.tool_input.command` only to decide *is this a commit*, then reads the index. A name-shape check needs nothing the two shipped gates do not already have.

**Zero false positives, measured over the whole estate.**

### Open: whether a rename is enough

Twelve files were repaired by hand on 2026-09-26 — seven renamed, five removed as superseded drafts whose readable counterpart was already correct and whose slices had merged. **The repair is done and the gate prevents recurrence.** Whether the gate should also offer the correct name in its refusal text, or merely refuse, is a wording decision for the slice.

### What this does NOT do

- **It does not change `brief-path.ts` or `plot-dispatch.sh`.** Both are right, agree, and are tested.
- **It does not widen a reader to accept both names.** That hides the inconsistency rather than fixing it, and a reader accepting a name no writer should produce makes the rule unenforceable.
- **It does not write briefs.** Who writes them is unchanged.
- **It does not repair existing files.** That was done; `git ls-tree origin/main .plot/briefs/` now reports 0 misnamed.

## Done when

- A commit adding `.plot/briefs/<prefix>-<slug>.md` is refused, naming the computed path.
- A `git mv` to a misnamed path is refused, read from the index as `R100`.
- A commit adding `.plot/briefs/<slug>.md` passes.
- A brief for a branch that does not exist yet passes.
- The gate fails open on its own machinery, as the other two do.
- It is registered by `plot-install-hooks.sh` and reported `current` on a second run.

## Slices

### A brief is named by the rule (Branch: `infra/a-brief-is-named-by-the-rule`)

The gate, its refusal text, its registration, and the four cases above.

## Notes

The corpus test `briefpath.test.mjs` already proves the shell and TypeScript agree. This adds the third party neither can reach: a person writing the file directly. That asymmetry — two correct implementations and an unguarded hand — is the same one `plot-state-gate.sh` was built for on 2026-09-09.
