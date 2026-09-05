# Every generated bundle is marked

> `.gitattributes` marks one of the nine bundles `build.mjs` emits. The other eight are blended by git, which splices conflict markers into generated JavaScript — and the one script licensed to repair such a conflict refuses, because its definition of *the artifact* is that single marked file.

## Status

- **Phase:** Draft
- **Type:** bug
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

**Nine bundles are emitted, one is marked.** `build.mjs` writes `board-server`, `plot-ask`, `plot-monitor`, `plot-movable`, `plot-prompt`, `plot-registryd`, `plot-task`, `plot-transition` and `plot-verdicts`. `.gitattributes:30` names only the first.

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

**Not a widening of what may be repaired automatically.** The licence rests on three verified properties: `-merge` keeps the file valid, the rebuild is deterministic, and CI's no-diff gate proves it. All three hold for every bundle `build.mjs` writes and for nothing else. The set grows to the bundles; it does not grow to *the artifact among the conflicts*.

## Slices

### Marking every bundle (Branch: bug/every-generated-bundle-is-marked)

`.gitattributes` lists all nine, with the existing comment block extended to say the list is the build's output rather than one file — and why it is now nine.

**Done when** a rebase conflicting in any bundle writes zero conflict markers into it.

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

**Done when** a conflict in any subset of the nine is repaired, a conflict set containing anything else is refused with `not-artifact-only`, and the cross-language test asserts the two declarations name the same set.

## Notes

### Why the two halves are separate slices — 2026-09-05

The `.gitattributes` change is one file and stops the damage — markers in generated output — immediately. The set-widening touches four source files, a shared constant and a contract test, and can be reviewed on its own. Splitting them means the marker splicing is fixed without waiting for the larger change.
