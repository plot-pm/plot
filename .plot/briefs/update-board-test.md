## Implementation brief — reconcile-scan-accuracy, branch 3 of 3

- **Plan (canonical):** `docs/plans/2026-08-15-reconcile-scan-accuracy.md` on `main`
- **Approved:** 2026-08-15, jwloka, plan-PR #101 merged
- **Branch:** `feature/update-board-test` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Wave:** Coverage — the final wave. Waves 1 and 2 merged as **#122** and
  **#125**, so the serialisation that held this back is released.

  The plan's own note says this wave is *"last because it is independent, not
  because it depends on them"* — the two scan fixes shared
  `plot-reconcile-scan.sh` and had to be serialised; this one does not.
- **Concurrency:** runs beside `bug/fleet-merged-branch-state`
  (`plot-fleet-scan.sh` + `fleet.test.mjs`) and `bug/board-shows-discovery`
  (`packages/board/**`). Stay inside
  `skills/plot/scripts/plot-update-board.sh` and its test. Do **not** touch
  `plot-fleet-scan.sh`, the board package, or the built artifact.

### What to build

Three properties of `plot-update-board.sh`, per the plan's Coverage section:
**argument handling**, **graceful degradation**, and **the caller-set
assertion**. Re-read that section on `main` — it is the specification, and this
brief does not restate it.

### Note on the pulse while you work

`plot-fleet-scan.sh` currently reports merged-and-deleted branches as `open`,
so the fleet pulse may show waves 1 and 2 as outstanding and this wave as
`blocked`. That is the defect `bug/fleet-merged-branch-state` is fixing in
parallel — **it is not a signal about your branch**. Both prior PRs are merged;
verify with `git log origin/main --merges` if in doubt.

### Done when

- The plan's Coverage deliverables are met — argument handling, graceful
  degradation, and the caller-set assertion, each pinned by a test.
- `pnpm run test:reconcile` and `pnpm run validate` pass.
- A changeset is present.
- macOS ships bash 3.2: no `declare -A`, no bash-4-only constructs. A test
  enforces this.
- **Assert per line, not with whole-output regexes.** This suite has been
  fooled three times by patterns matching across report lines or the summary
  footer.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`.

### Scope guard

Waves 1 and 2 are done (#122, #125) — do not revisit them. Drift → back to the
plan.
