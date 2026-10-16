---
'plot': patch
'@plot-pm/board': patch
---

An unresolved git host backend no longer reads as a confirmed GitHub answer, and a missing checks commit is worded identically wherever it is shown.

`resolveBackend` now assigns `''` rather than `'github'` when the host CLI's `backend()` call fails or has not answered yet, and every one of `fleet.ts`'s eleven downstream `entry.backend ?? 'github'` fallbacks now reads `?? ''` to match — fixing #1679, where a Bitbucket repository whose backend had not resolved got its git-host-sourced tickets matched against GitHub logins instead of left unmatched, hiding every one of them. `checksShaSuffix` in `packages/domain/src/rules/checks-reading.ts` now exports its "no commit is recorded for these checks" sentence as `CHECKS_SHA_MISSING`, and `checksBinding` in `index-findings.ts` calls it rather than restating the sentence, so the IndexMonitor's published evidence and the board's badge `detail` text say the identical fact — fixing #1546. `checksBinding`'s own `checksSha === ''` case, which used to render `for , head X`, now takes the same "nothing recorded" branch as `undefined`.

<!--
plan: docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md
bumps:
  skills:
    plot: patch
-->
