## Implementation brief — every-generated-bundle-is-marked (slice: Marking every bundle)

- **Plan (canonical):** `docs/plans/2026-09-05-every-generated-bundle-is-marked.md` on `main`
- **Branch:** `bug/every-generated-bundle-is-marked` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of two. One round.

## The defect, measured on a real rebase

**2026-09-05, rebasing `feature/a-story-lifecycle-refuses` onto main:**

```
board-server.mjs      0 conflict markers   (marked -merge)
plot-ask.mjs          5 conflict markers   (NOT marked)
plot-registryd.mjs    3 conflict markers   (NOT marked)
```

The marked file behaved exactly as `.gitattributes` documents: git kept one side whole and wrote no markers, so the artifact stayed valid JavaScript through the conflict. **The two unmarked ones were line-merged, and eight conflict markers were spliced into generated output.**

**This has recurred every session since.** Four separate branches needed hand-resolution of the same three bundles while this plan sat in Draft.

## What to build

**`.gitattributes` lists all eight bundles `build.mjs` emits**, with the existing comment block extended to say the list is the build's output rather than one file.

**EIGHT, NOT NINE.** Verified 2026-09-06 — `build.mjs` has eight `shippedX = path.join(…)` declarations:

```
board-server  plot-ask  plot-movable  plot-prompt
plot-registryd  plot-task  plot-transition  plot-verdicts
```

**`plot-monitor.mjs` IS NOT MARKED, and that is deliberate.** It is tracked, committed by #610, documented at `entry/monitor.ts:14` — and appears in **no `outfile`**. Nothing rebuilds it, so it has no deterministic-rebuild property, which is what the `-merge` licence rests on. Marking it would assert a rebuild that does not exist.

## The blast radius is accepted

The attribute changes how git resolves every future conflict in those files, for anyone rebasing any branch. **What it replaces is worse:** a spliced marker makes a bundle invalid JavaScript that can still be committed and pushed, and the file is one nobody is meant to read a diff of — `.gitattributes:7` says so already.

**All eight are marked, not only the two that have hurt.** The other six differ from `plot-ask.mjs` in nothing that matters, and marking only what has already failed leaves the same latent defect under a different filename.

## A GATE, NOT A LIST TO REMEMBER

**This defect was born the way a prose reminder fails:** `build.mjs` gained seven outputs after the attribute was written and none of them touched `.gitattributes`.

So `scripts/check-bundle-attributes.sh` derives the emitted set from `build.mjs` — the eight `shippedX = path.join(…)` declarations — and fails when any is missing from `.gitattributes`.

**It joins the repo's other declaration gates:** `check-ancestry-decisions.sh`, `check-changeset-packages.sh`, `check-plan-headings.sh`, `check-host-cli-callers.sh`, `check-state-declarations.sh`. That last one shipped 2026-09-06 and is the closest model — it derives a set from source and ratchets.

**CLAUDE.md's test:** *can you answer "did I complete this?" without doing the work?* A prose note asking the next author to remember three files fails it; a gate does not.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

**The gate must fail on a deliberately added ninth output** — a gate nothing tests is a gate that passes because nobody looked, which `check-host-cli-callers.sh` says in its own header and proves with `test/reconcile/host-cli-gate.test.mjs`.

## Done when

- a rebase conflicting in any built bundle writes zero conflict markers into it
- all eight `build.mjs` outputs are marked `-merge`
- `plot-monitor.mjs` is **not** marked, and the reason is in the comment
- adding a ninth output without marking it fails CI, proven by a test
- the gates above pass

## Do not

- **Do not mark `plot-monitor.mjs`.** Nothing builds it; the licence rests on a deterministic rebuild.
- **Do not mark only the two that have conflicted.** Same latent defect, different filename.
- **Do not change the `-merge` argument.** `.gitattributes:21` explains why this is an attribute rather than a `merge=rebuild` driver: a driver definition lives in each clone's `git config`, so CI and fresh clones would silently fall back.
- **Do not widen `plot-resolve-artifact.sh`'s set here.** That is slice 2, and it touches `ARTIFACT_PATH`, `BOARD_ARTIFACT_PATH` and two `conflicts.length === 1` checks that must move together.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
