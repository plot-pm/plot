---
'plot': patch
---

A desk that holds only a rebuilt `plot-restart-stopped-command.mjs` reads clean. `plot-desk-dirt.sh`'s `bundle_paths` and the domain's `bundlePathsOf` read `packages/board/build.mjs` with each newline as a space, so a `shipped<Name>` declaration whose `path.join(` arguments wrap over several lines counts as a generated bundle. The one-line reading found 79 of the 80 declarations at b7808d7af and missed `shippedRestartStoppedCommand`, so the reap, the dispatch release and the fleet's desk check read a desk with that rebuilt bundle as dirty, and `resetOnto` did not restore it.

<!--
bumps:
  skills:
    plot: patch
-->
