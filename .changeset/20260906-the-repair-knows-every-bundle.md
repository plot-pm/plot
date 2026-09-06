---
'@plot-pm/board': minor
---

The artifact repair knows every generated bundle, not one filename. `ARTIFACT_PATH` named `board-server.mjs` and nothing else, in both languages that hold it — so a conflict in any of the other eight bundles was refused as needing judgement and repaired by hand. Measured 2026-09-06: PR #727 conflicted in `plot-registryd.mjs`, a `-merge` bundle with a deterministic rebuild and exactly the case the resolver exists for, and was refused; hours later the same branch conflicted in `board-server.mjs` and the same resolver repaired it automatically.

`plot-resolve-artifact.sh` derives its set from `packages/board/build.mjs`, by the same `shippedX = path.join(…)` pipeline `scripts/check-bundle-attributes.sh` uses, read from the repository being repaired — that is the build whose `pnpm build:board` will run. A derivation finding nothing refuses `no-bundle-set` rather than proceeding against a set no guard can be exact about. The repair takes a side of each conflicted bundle and stages the whole set after the rebuild, since one build regenerates all of them.

`BOARD_ARTIFACT_PATHS` replaces `BOARD_ARTIFACT_PATH` in the board contract, with `isBoardArtifact` as the one membership helper `mayResolve` and `isArtifactOnly` both call. The contract's list is hand-written because the board is a bundle that must not read the repository to load, and `test/reconcile/resolveartifact.test.mjs` asserts set equality across the build, the script's derivation and that list in both directions — a missing entry refuses a licensed repair, an extra one claims a rebuild that does not exist. The previous test compared a single filename, which stayed green throughout the window in which the two sides disagreed about the other eight.

The guard's discipline is unchanged: every unmerged path must be a bundle, never a bundle among the conflicts. The empty set is refused explicitly, since `every` holds over it vacuously. `plot-monitor.mjs` stays out — nothing builds it, so it has no deterministic rebuild, and the rebuild is the whole licence.

<!--
bumps:
  skills:
    plot: patch
-->
