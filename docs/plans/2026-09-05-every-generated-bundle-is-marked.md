# Every generated bundle is marked

> `.gitattributes` marks one of the eight bundles `build.mjs` emits. The other seven are blended by git, which splices conflict markers into generated JavaScript — and the one script licensed to repair such a conflict refuses, because its definition of *the artifact* is that single marked file.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** every-concept-has-one-owner
- **Review:** pr
- **Impl:** own branches

## Changelog

- Every bundle `packages/board/build.mjs` writes is marked `-merge`, and the artifact-conflict repair path recognises the whole set rather than one file.

<!-- Board impact: the board's own `BOARD_ARTIFACT_PATH` and its two
     `conflicts.length === 1` checks move together with the shell script. -->

## Problem

**Measured 2026-09-05, on a real rebase.** `feature/a-story-lifecycle-refuses` rebased onto main and conflicted in three bundles:

```
board-server.mjs      0 conflict markers   (marked -merge)
plot-ask.mjs          5 conflict markers   (not marked)
plot-registryd.mjs    3 conflict markers   (not marked)
```

The marked file behaved exactly as `.gitattributes` documents: git kept one side whole and wrote no markers, so the artifact stayed valid JavaScript through the conflict. The two unmarked ones were line-merged, and **eight conflict markers were spliced into generated output**.

**Eight bundles are emitted, one is marked.** `build.mjs` writes `board-server`, `plot-ask`, `plot-movable`, `plot-prompt`, `plot-registryd`, `plot-task`, `plot-transition` and `plot-verdicts` — eight `shippedX = path.join(...)` declarations. `.gitattributes:30` names only the first.

**A ninth file sits in the directory that nothing builds.** `skills/plot/scripts/board/plot-monitor.mjs` is tracked, was committed by *A monitor is a pure rule* (#610), and appears in no `outfile` in `build.mjs`. `packages/board/src/server/entry/monitor.ts:14` documents piping into it. So it is a committed artifact with no producer: `pnpm build:board` does not refresh it, and CI's no-diff gate therefore cannot notice if it goes stale. **It is not covered by this plan's licence** — the licence rests on the rebuild being deterministic, and a file nothing rebuilds has no such property. Whether it should be built or deleted is a separate question this plan records and does not answer.

**The reason is chronological, not principled.** The comment block above that line argues from the file being generated, enormous, and reproducible by `pnpm build:board` — every word of which is true of all nine. It was written when there was one bundle, and each new one has been added without it.

**And the repair script refuses.** `plot-resolve-artifact.sh` is the one automatic write this system grants. Run against that branch it answered:

```
step: conflict set is not exactly the artifact — refusing
step: unmerged: board-server.mjs plot-ask.mjs plot-registryd.mjs
summary: outcome=refused reason=not-artifact-only
```

The refusal is correct under its own definition — `ARTIFACT_PATH` is one string, and the guard is `n_unmerged != 1`. But the conflict set *was* artifact-only, so the script declined the exact case it exists for, and a person resolved three generated files by hand.

## What this is not

**Not a change to the `-merge` argument.** `.gitattributes:21` explains why this is an attribute rather than a `merge=rebuild` driver — a driver definition lives in each clone's `git config`, so CI and fresh clones would silently fall back to a normal merge. That reasoning is untouched.

**Not a widening of what may be repaired automatically — and this is the plan's most load-bearing claim, because `resolver.ts:25` warns against exactly the change being made here:**

> Widening the entry condition, adding a second automatic path, or pushing before the local gate would each remove the argument that grants the permission — while leaving code that still looks correct.

**The warning holds and the change is still safe, because the licence is per-file rather than per-name.** Its three properties — `-merge` keeps the file valid, the rebuild is deterministic, CI's no-diff gate proves it — are properties of BEING a `build.mjs` output. Each of the eight satisfies all three independently, so the argument does not stretch to cover more files; it holds eight times over. What the warning forbids is a set that admits a file lacking those properties, and `plot-monitor.mjs` above is precisely such a file — which is why it is named and excluded rather than swept in with the others.

**The set grows to the build's outputs; it does not grow to *the artifact among the conflicts*.** That distinction is what `plot-resolve-artifact.sh:277` protects, and it survives untouched.

**THE BOARD SPAWNS THIS WITHOUT A PERSON.** `resolver.ts` auto-starts the repair whenever `repairEnabled !== false`, so the widened set takes effect on an unattended path. That is why the licence is argued here rather than assumed: there is no human between the classification and the push.

## Slices

### Marking every bundle (Branch: bug/every-generated-bundle-is-marked)

`.gitattributes` lists all eight `build.mjs` emits, with the existing comment block extended to say the list is the build's output rather than one file — and why it is now eight.

**THE BLAST RADIUS IS ACCEPTED, AND IT IS THE SMALLER HARM.** The attribute changes how git resolves every future conflict in those files, for anyone rebasing any branch. What it replaces is worse: a spliced conflict marker makes a bundle invalid JavaScript that can still be committed and pushed, and the file is one nobody is meant to read a diff of — `.gitattributes:7` says so already. Keeping one side whole costs a reader nothing, because the resolution is a rebuild rather than a read.

**All eight are marked, not only the two that have hurt.** `plot-ask.mjs` and `plot-registryd.mjs` are the measured pair; the other six differ from them in nothing that matters, and marking only what has already failed leaves the same latent defect under a different filename.

**`plot-monitor.mjs` IS NOT MARKED**, because nothing builds it. Marking it would assert a rebuild that does not exist.

**A GATE, NOT A LIST TO REMEMBER.** A new bundle must not be able to arrive unmarked, which is how this defect was born: `build.mjs` gained seven outputs after the attribute was written and none of them touched it. So `scripts/check-bundle-attributes.sh` derives the emitted set from `build.mjs` — the eight `shippedX = path.join(…)` declarations — and fails when any of them is missing from `.gitattributes`. It joins the repo's other declaration gates (`check-ancestry-decisions.sh`, `check-changeset-packages.sh`, `check-plan-headings.sh`) and answers CLAUDE.md's own test: *can you answer "did I complete this?" without doing the work?* A prose note asking the next author to remember three files fails that test; a gate does not.

**Done when** a rebase conflicting in any built bundle writes zero conflict markers into it, and adding a ninth output to `build.mjs` without marking it fails CI.

### One definition of the artifact set (Branch: bug/the-repair-knows-every-bundle)

`ARTIFACT_PATH` becomes a set, in both languages that hold it.

**THREE PLACES DECLARE IT AND THEY MUST MOVE TOGETHER:**

| where | today |
|---|---|
| `plot-resolve-artifact.sh:76` | `ARTIFACT_PATH="…/board-server.mjs"` |
| `contract/schema.ts:1868` | `BOARD_ARTIFACT_PATH = '…/board-server.mjs'` |
| `resolver.ts:86`, `stuck.ts:142` | `conflicts.length === 1 && conflicts[0] === BOARD_ARTIFACT_PATH` |

`plot-resolve-artifact.sh:75` already says the pairing is *"asserted by a test rather than trusted"*, because the two run in different languages and neither can import the other's constant. That test is what must now assert set equality.

**THE GUARD'S DISCIPLINE SURVIVES THE WIDENING.** `plot-resolve-artifact.sh:277` warns against asking whether the artifact is *among* the conflicts: an implementation asking that "passes every artifact-only case and silently repairs merges that need judgement as a whole." The new guard is **every unmerged path is in the bundle set** — still an exact claim about the whole set, never a membership test on one element.

**Done when** a conflict in any subset of the eight is repaired, a conflict set containing anything else is refused with `not-artifact-only`, and the cross-language test asserts the two declarations name the same set.

## Notes

### Why the two halves are separate slices — 2026-09-05

The `.gitattributes` change is one file and stops the damage — markers in generated output — immediately. The set-widening touches four source files, a shared constant and a contract test, and can be reviewed on its own. Splitting them means the marker splicing is fixed without waiting for the larger change.

**Both are wanted now rather than queued.** Three agents landing PRs that each rebuild the bundles means every parallel merge is a candidate, and the estate ran three at once on the day this was written. Hand-resolution does not scale with the fleet, and each hand-resolution is a chance to commit a marker into shipped JavaScript.

### The ninth file — 2026-09-05

`plot-monitor.mjs` is tracked, has an entry point documented at `entry/monitor.ts:14`, and has no `outfile` in `build.mjs`. Either it should be built — in which case it joins the eight and the gate covers it — or it is dead and should be deleted. This plan does neither, because both answers need a reading of #610 that its scope does not include. It is named here so the next person meets it as a recorded question rather than a surprise.
