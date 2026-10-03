---
'plot': minor
'@plot-pm/board': patch
---

`plot-approve.sh --who <handle> <slug>` performs an in-session approval end to end, and `plot-deliver.sh --release <version> <slug>` cuts a Delivered plan's `Released:` record by resolving the version from its merge commit — closing the two biggest sources in `.plot/state/unowned-state-writes.tsv` (109 `Approved` and 112 `Released` receipts on this checkout). `POST /api/approve` now takes `who` and answers 409 on the agent arm for an in-session plan rather than spawning an agent that would only refuse; `POST /api/release` is new and has no agent arm. `plot-controller-gate.sh` scopes its `--release` exemption to `plot-dispatch.sh` alone, so `plot-deliver.sh --release` is gated as its own `release` action.

<!--
plan: docs/plans/2026-10-01-an-in-session-approval-has-a-controller.md
bumps:
  skills:
    plot-approve: minor
    plot-release: minor
    plot: patch
-->
