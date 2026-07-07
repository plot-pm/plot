---
"plot": patch
---

Follow-up fixes to the reconcile drift loop (#34/#35), from review of the combined set:

- **plot-deliver** — step 7b recast from a rule into a real gate: progression is gated on the reconcile scan's actual output (the grep result / `summary:` footer), not a self-asserted "Verified" bullet (which was emittable without running the scan). Also `mkdir -p docs/plans/delivered` before the symlink move, so the first-ever delivery in a fresh adopter repo can't half-land.
- **plot** — the reconcile scan now (1) fails loudly with a `command -v jq` guard instead of silently reporting `drift=0` when jq is absent; (2) routes terminal-state (`Superseded`/`Rejected`) symlinks to the `delivered/` terminal index instead of the wrong `active/` default, and flags a terminal plan still symlinked in `active/` as §1 drift; (3) gains `--no-pr`/`--offline` flags, and the `/plot` hygiene line uses `--offline` so it makes no forge network call (previously `--no-fetch` still ran `gh/bb pr list` on every `/plot`). `pr_source` reports `off` for the deliberate skip.
- **docs** — `CLAUDE.md` Helper Scripts table lists `plot-plan-meta.sh`, `plot-config.sh`, and `plot-reconcile-scan.sh`.

<!--
bumps:
  skills:
    plot: patch
    plot-deliver: patch
    plot-reconcile: patch
-->
