---
"plot": patch
---

Claim detection no longer trusts a commit subject alone.

A second audit — this time of the fixes themselves — found that classifying a claim by commit subject was unsafe. A human commit titled `plot: claim handling refactor`, carrying real files, counted as an empty claim; with a `deferred:` annotation on that branch, the reaper then offered to **delete a branch holding real, unmerged work**.

A claim marker is now required to be both titled `plot: claim …` **and** empty (its tree equals its parent's). The impostor is correctly demoted to "orphan (needs judgment)" with an inspection command instead of a deletion command, while genuine claims are still detected. Both detectors — `plot-fleet-scan.sh` and `plot-reconcile-scan.sh` — share one rule.

Two untested surfaces are now covered. `--loose`'s positive path was unreachable in tests because every invocation passed `--offline`, which disables the fetch and so made readiness unverifiable — only the degraded path was ever exercised. A stubbed host now covers ready, draft, and unavailable. And `--max` validation had no test at all: reverting the guard left the whole suite green.

Four doc passages still described the superseded mechanism ("an empty branch with no commits of its own is a claim"). They now describe what the code does, and `plot-fleet/README.md` records why the empty-branch design failed — it is the kind of mistake worth leaving a marker for.
