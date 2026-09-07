## Implementation brief — the-bundle-set-is-derived-once (slice: The contract derives what build.mjs emits)

- **Plan (canonical):** `docs/plans/2026-09-07-the-bundle-set-is-derived-once.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/the-bundle-set-is-derived-once` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

One slice. The plan's Notes explain why this is worth a plan rather than a fourth hand-edit — **the list drifted three times in one evening.**

## What this delivers

`BOARD_ARTIFACT_PATHS` (`packages/board/src/contract/schema.ts:1905`) is **computed** from the build's own declarations rather than typed out.

## There is one source, and two readers already derive from it

`packages/board/build.mjs` declares each output as `shippedX = path.join(…, '../../<path>')`. Two consumers already read those declarations rather than carrying a list:

- `skills/plot/scripts/plot-resolve-artifact.sh:108` — `bundle_set()`, a `grep -aoE "shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)"` piped through `sed` and `sort -u`
- `scripts/check-bundle-attributes.sh` — the CI gate, which found a ninth bundle the plan that created it had not

**This is the third reader, not a fourth definition.**

## The one thing it must not do

**DO NOT MAKE THE CONTRACT IMPORT THE BUILD.** `contract/schema.ts` is the board's wire shape; `build.mjs` is a build script. A runtime `import('../../build.mjs')` drags esbuild's config into the served bundle.

**Two shapes are acceptable:** generate the list at build time into a module the contract imports, or read the declarations as data. Neither makes the served bundle depend on esbuild.

## The test stays, and its meaning changes

It stops asserting *someone remembered* and starts asserting *the derivation works*.

**Keep it pointed at all three sources** — `build.mjs`, the shell's `bundle_set`, and the contract. The shell and the TypeScript still cannot import each other, and that pairing is exactly what `plot-resolve-artifact.sh:75` says must be **"asserted by a test rather than trusted."**

## Why this is worth doing rather than editing the list again

Measured across one evening: the contract listed **9**, then **10**, then **11** bundles while `build.mjs` emitted one more each time — `plot-delta.mjs` from #740, then `plot-standing.mjs`. Each drift surfaced as an unrelated branch's CI failing on a bundle it never touched.

**That is the failure to remove:** a bundle added in one PR must not be able to fail another branch's CI.

## Verification

- Add a bundle to `build.mjs` in a scratch commit and confirm **no edit to `contract/schema.ts` is needed**. Revert it.
- The contract test passes with no hand-maintained list.
- `./scripts/check-bundle-attributes.sh` still passes.
- `plot-resolve-artifact.sh --dry-run` on any branch still reports the same bundle set.

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:board
pnpm run typecheck
```

**Do NOT run `pnpm run test:e2e`.** CI's gate, not a local one.

**On a conflict in `skills/plot/scripts/board/*.mjs`: do not read the diff.** Generated bundles marked `-merge`. Take either side, `pnpm build:board`, commit the rebuild.

**`test:board` dirties `tiny-garden/.plot/state/last-pulse.json`.** Revert before staging.

## Done when

Adding a bundle to `build.mjs` requires no edit to `contract/schema.ts`, the contract test passes without a hand-maintained list, and a bundle added in one PR cannot fail an unrelated branch's CI.
