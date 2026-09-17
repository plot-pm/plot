---
'plot': patch
---

The board probe reads the Jenkins auth word the CLI prints. `plot-board-probe.sh:266` matched `Jenkins auth:  reachable`, which `jen` does not emit — it prints `Jenkins auth:  OK — user@host`, measured live 2026-09-17. A reachable Jenkins therefore scored `unknown` rather than `ok`, and the miss was silent in both directions: `classify` answers `failed` only on a non-zero exit, and `jen` exits 0 on its failure branch too, so the exit code carries no signal and only that line does. Three fixtures fed the probe the same invented string, so 38 tests were green over a reading that could never fire. The word is replaced rather than widened — `ok|reachable` would keep all three green and keep the fiction — and a gate now asserts the dead string is absent from the fixture file, matching a string literal rather than a mention so the rule can still be described in prose beside it. `NOT reachable` still reads `failed` and is still tested first, and an unrecognised line, a Keycloak-only sign-in, an unset instance and an absent `jen` all still read `unknown`.

<!--
plan: docs/plans/2026-09-17-a-probe-reading-is-not-a-guess.md
bumps:
  skills:
    plot: patch
-->
