# The bundle set is derived once

> The board contract lists the built bundles by hand. It went stale three times in one evening — nine, then ten, then eleven — and each time a merge failed a test nobody was expecting to fail. The shell derives the same set from `build.mjs` and cannot drift.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #766 merged
- **Started:** 2026-09-07, Jan Wloka, `bug/the-bundle-set-is-derived-once`
- **Delivered:** 2026-09-07
- **Released:** 2026-09-08, 2.14.0

## Changelog

- The board's artifact list is derived from `build.mjs` rather than written by hand, so adding a bundle cannot break an unrelated branch.

<!-- Board impact: none at runtime. The list is read by the artifact-conflict
     resolver and its contract test, not by anything the board renders. -->

## Motivation

**Measured 2026-09-06, three times in one evening.** `BOARD_ARTIFACT_PATHS` in `packages/board/src/contract/schema.ts` is a hand-written array, and `test/reconcile/resolveartifact.test.mjs` asserts it equals what `build.mjs` emits:

| when | contract | build.mjs | the bundle |
|---|---|---|---|
| #738 branched | 9 | 10 | `plot-delta.mjs`, added by #740 |
| #746 first merge | 10 | 11 | `plot-standing.mjs`, added by the sprint-dates work |
| #746 second merge | 11 | 11 | — |

**Each failure landed on a branch that had nothing to do with bundles.** #746 is a story-lint slice; it failed twice on a list it never touched, and each repair cost a merge, a rebuild and a CI round trip.

**THE SHELL SIDE ALREADY SOLVED THIS.** `plot-resolve-artifact.sh:149` calls `bundle_set "$repo_root"`, which reads `build.mjs`'s `shippedX = path.join(…)` declarations. It has never gone stale, because it derives.

**AND THE GATE THAT WAS BUILT FOR THIS ONLY GUARDS ONE SIDE.** `scripts/check-bundle-attributes.sh` derives the emitted set and fails when a bundle is missing from `.gitattributes` — the same defect, already solved, one file over. Nothing does it for the TypeScript list.

## What this is not

**Not a change to the resolver's licence.** Which conflicts may be repaired mechanically is settled and stays: every unmerged path must be in the bundle set, never a membership test on one element.

**Not a removal of the contract test.** The test is what caught all three drifts. It stops being able to fail once both sides derive, which is the point — a test that cannot fail because the defect is unreachable is different from one that was deleted.

## Slices

### The contract derives what build.mjs emits (Branch: bug/the-bundle-set-is-derived-once, PR: #773)

`BOARD_ARTIFACT_PATHS` is computed from the build's own declarations rather than typed out.

**THE SOURCE IS `build.mjs` AND THERE IS ONLY ONE.** `bundle_set` and `check-bundle-attributes.sh` both already read it; this is the third reader, not a fourth definition.

**IT MUST NOT MAKE THE CONTRACT IMPORT THE BUILD.** `contract/schema.ts` is the board's wire shape and `build.mjs` is a build script — a runtime import would drag esbuild's config into the served bundle. Generate the list at build time, or read the declarations as data; do not `import('../../build.mjs')`.

**THE TEST STAYS AND ITS MEANING CHANGES.** It stops asserting *someone remembered* and starts asserting *the derivation works*. Keep it pointed at all three sources — `build.mjs`, the shell's `bundle_set`, and the contract — because the shell and the TypeScript still cannot import each other, and that pairing is what `plot-resolve-artifact.sh:75` says must be *"asserted by a test rather than trusted."*

**Done when** adding a bundle to `build.mjs` requires no edit to `contract/schema.ts`, the contract test passes without a hand-maintained list, and a bundle added in one PR cannot fail an unrelated branch's CI.

## Notes

### Why this is worth a plan rather than a fourth hand-edit — 2026-09-07

Three drifts in one evening, each caught by a test on a branch that had nothing to do with bundles, each costing a merge and a CI round trip. The fourth is already possible: `build.mjs` emits eleven bundles today and nothing stops a twelfth landing tomorrow.

**The estate has the pattern in two places already.** `bundle_set` derives; `check-bundle-attributes.sh` derives. The hand-written list is the odd one out, and it is the only one that has ever been wrong.
