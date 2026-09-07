---
'@plot-pm/board': patch
---

`BOARD_ARTIFACT_PATHS` is derived from the build rather than typed out. It was a hand-written list in `contract/schema.ts` and it drifted three times in one evening — 9, then 10, then 11 entries against a `build.mjs` emitting one more each time. Every drift surfaced as an UNRELATED branch's CI failing on a bundle it never touched, which is the failure removed: a bundle added in one PR must not be able to fail another branch's CI.

`build.mjs` now writes `src/contract/bundles.generated.ts` from its own shipped-bundle declarations, using the regex `scripts/check-bundle-attributes.sh` and `plot-resolve-artifact.sh`'s `bundle_set()` already derive with. This is the third reader, not a fourth definition. The contract re-exports that module and never imports the build — the contract is bundled INTO the artifacts it describes, so a runtime import would drag esbuild's config into the served bundle.

The generated module is committed rather than ignored because CI runs `typecheck` before `build:board` and `tsc --noEmit` does not build; an ignored file would fail typecheck on a fresh clone. It is a bundle INPUT, so it carries no `-merge` mark: a conflict there is a real conflict about which bundles exist.

The generator runs before any `esbuild.build` call, because the contract it feeds is bundled into every artifact after it.

**The derivation reads `build.mjs` as text, so prose about the derivation is matched by it.** Measured while making this change: two comments explaining the shape put `<path>` and an ellipsis into the derived set, and `plot-resolve-artifact.sh` read both as bundles it might repair — a pre-existing fragility in all three readers, surfaced by being the first change to write such prose into the file the derivation reads. The pattern spans newlines, so a wrapped comment matches too. The prose now describes the shape in pieces, and the contract test asserts every derived entry is a file on disk.

`test/reconcile/resolveartifact.test.mjs` keeps pointing at all three sources and changes meaning: it asserted that somebody had remembered to update a list — only ever red after the damage — and now asserts the derivation ran.

<!--
plan: docs/plans/2026-09-07-the-bundle-set-is-derived-once.md
-->
