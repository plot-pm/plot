---
"plot": minor
---

Add `/plot-reconcile` — a read-only plan/branch reconciliation sweep — plus the shared plan parser and Plot Config accessor it is built on.

A new spoke command that surfaces drift that per-delivery attention misses and only becomes visible in aggregate: a plan's phase disagreeing with which index dir (`active/` vs `delivered/`) its symlink lives in; an `Approved` plan whose impl branch already merged; merged-but-undeleted branches; and malformed plans (missing phase, front-matter `status:`/`phase:` disagreement).

- **plot-reconcile** (new skill, v1.0.0) — two-stage Scan→Act command. Stage 1 runs `plot-reconcile-scan.sh`, a deterministic five-section report where each finding carries its exact remediating command as copy-paste text. Stage 2 is the human's judgment on what to run. Read-only by construction — the only writes are `git fetch` and (when unset) the local `origin/HEAD` ref.
- **plot** (dispatcher) — add `/plot-reconcile` to the spoke command list, plus two new shared helpers all tooling should build on: `plot-plan-meta.sh` (plan metadata as JSON — parses both the canonical `## Status` body format and YAML front matter; the plan-format contract, specified by example in `test/reconcile/`) and `plot-config.sh` (the `## Plot Config` reader).

Forge-aware: open-PR enumeration binds to the forge of the `origin` remote — `gh` on GitHub, `bb` on Bitbucket — and degrades to git merge-state alone otherwise. The main branch is detected from `origin/HEAD` (override with `- **Main branch:** <name>` in `## Plot Config`); plan directory, indexes, and branch prefixes are read from `## Plot Config` too.

Proven twice in a downstream monorepo (each run caught genuine drift a human then fixed) before being contributed upstream; contract-tested end-to-end in CI.

<!--
bumps:
  skills:
    plot: minor
-->
