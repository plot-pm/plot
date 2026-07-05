---
"plot": minor
---

Add `/plot-reconcile` — a read-only plan/branch reconciliation sweep.

A new spoke command that surfaces drift that per-delivery attention misses and only becomes visible in aggregate: a plan's `status:` disagreeing with which index dir (`active/` vs `delivered/`) its symlink lives in; an `Approved` plan whose impl branch already merged; merged-but-undeleted branches; and malformed plans (missing `status:`, `status:`/`phase:` disagreement).

- **plot-reconcile** (new skill, v1.0.0) — two-stage Scan→Act command. Stage 1 runs `plot-reconcile-scan.sh`, a deterministic five-section report where each finding carries its exact remediating command as copy-paste text. Stage 2 is the human's judgment on what to run. Read-only by construction — the only write it performs is `git fetch`.
- **plot** (dispatcher) — add `/plot-reconcile` to the spoke command list.

gh-native: open-PR enumeration uses `gh pr list --state open --json headRefName`, degrading to git merge-state alone when `gh` is unavailable. The integration branch the sweep compares against defaults to `main` and is overridable via a `- **Integration branch:** <name>` line in `## Plot Config`.

Proven twice in a downstream monorepo (each run caught genuine drift a human then fixed) before being contributed upstream.

<!--
bumps:
  skills:
    plot: patch
-->
