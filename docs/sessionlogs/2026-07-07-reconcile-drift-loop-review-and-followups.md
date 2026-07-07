# Reconcile drift-loop — review of #33/#34/#35, then follow-up fixes

**Date:** 2026-07-07
**Scope:** Critical review of the reconciliation-sweep feature set, then a fix PR addressing every finding
**Issue / PRs reviewed:** [#33](https://github.com/plot-pm/plot/issues/33) (umbrella), [#34](https://github.com/plot-pm/plot/pull/34) (`/plot-reconcile` read-only sweep), [#35](https://github.com/plot-pm/plot/pull/35) (dispatcher hygiene line + `/plot-deliver` step 7b)
**Fix PR:** [#37](https://github.com/plot-pm/plot/pull/37) — merged (`5c159d3`), shipped in **1.6.0**
**Branch:** review on `worktree-plot-review`; fixes on `fix/reconcile-drift-loop-followups`

## What

Two phases in one session.

**Phase 1 — review.** Read #33/#34/#35 as a coherent set (they compose: #35 built on #34's branch). Verdict: **no blockers**. Verified empirically rather than by eye:
- **#34's "read-only" claim** — ran the scan on plot's own repo, diffed full repo state before/after → identical. Confirmed the only writes are `git fetch` + a conditional `git remote set-head` (both disclosed).
- **Drift logic** — dogfooded on plot's real plans; §2 correctly flagged `2026-03-15-board-sync.md` (genuinely `Phase: Approved` with a merged branch — a true positive).
- **Step 7b "gate"** — traced that a clean delivery produces no grep hit (no false trap) while a half-landed one is caught.

Review artifact written to `docs-review-33-34-35.md` (left uncommitted per the review brief — it was a for-Max-first artifact, now superseded by the merged fix).

**Phase 2 — fixes (PR #37, 6 commits).** Max reviewed the report and directed a fix PR addressing all findings:
1. **Step 7b recast as a real gate** (`plot-deliver/SKILL.md`) — killed the pre-written `- Verified: reconcile scan clean` summary bullet; progression now gates on the scan's *actual output* (real grep result → hard stop / re-run until empty; real `summary:` footer carried into the Summary as the objective artifact). Plus `mkdir -p docs/plans/delivered` before the symlink move.
2. **jq guard** (`plot-reconcile-scan.sh`) — `command -v jq` aborts with exit 1 instead of silently reporting `drift=0`.
3. **Terminal-state routing** — `Superseded`/`Rejected` orphans route to `delivered/`; a terminal plan still in `active/` is now flagged as §1 drift.
4. **`--no-pr`/`--offline` flags** — `/plot` hygiene line uses `--offline`; `pr_source=off`.
5. **`CLAUDE.md` helper table** — added the three new shared scripts.
6. **Changeset** (`plot`/`plot-deliver`/`plot-reconcile` patch bumps).

`pnpm test:reconcile` went 28 → **32** (3 new tests: jq-guard exit, `--offline`/`pr_source=off`, terminal-state drift + orphan routing).

## Non-obvious decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Is step 7b a gate or a rule? | **Rule** (flagged in review), then **reformulated to a real gate** in the fix | By CLAUDE.md's own test ("can you answer 'did I complete this?' without doing the work?"), the original was a rule — a claimable `Verified:` bullet emittable without running the scan. |
| Does a real gate need a hook? | **No** — I over-constrained this in the review; Max corrected it | A gate's enforcement can be the *workflow structure* itself (show-your-work on a real artifact), not only a PreToolUse/PostToolUse hook. The reformulation makes delivery-complete depend on the pasted scan output. Dropped the "requires a `hooks/` dir" framing. |
| `--no-fetch` vs a new offline mode | Added `--no-pr`/`--offline` | Advisor caught that `--no-fetch` skips only `git fetch`, **not** the `gh/bb pr list` call — so the ambient `/plot` hygiene line fired a forge network round-trip (and API quota) on *every* `/plot`. Measured: `--offline` 0.24s (gh not called) vs `--no-fetch` 3.4s with a slow gh stub. |
| Terminal-state orphan target | Route to `delivered/`, not `active/` | #33 itself reported the scan's auto-suggestion for a `Superseded` plan was wrong (defaulted to `active/`; correct is the terminal index). The upstream PR reproduced the wart; the fix routes terminal phases to `delivered/`. |
| PR base after #34/#35 merged mid-session | Retarget to **`main`** | Directive was to stack on #35's branch (`idea/reconcile-drift-loop`), but #34 and #35 both merged while the fixes were being written and their branches were deleted. My branch sat on #35's merged tip (`ade7164`, now an ancestor of main), so a PR to main showed exactly the 6 commits with no conflicts — the faithful realization of "stack on #34+#35's work". |

## Verification

- `pnpm test:reconcile` → **32/32**; `pnpm test` (skill parse) + `pnpm run validate` → clean, 0 warnings.
- Read-only behavior and the offline timing delta re-confirmed empirically on plot's own repo.
- PR #37 merged to main (`5c159d3`) and released in **1.6.0** (`e8f5dfa`) via the changeset-release flow — the fixes are live.

## Notes for next time

- The `eins78/plot` → `plot-pm/plot` transfer redirect works for `git push` (GitHub rewrites it), but `gh pr create` still needs explicit `--repo plot-pm/plot`, and the API 404s on slash-containing branch names via the `/branches/{name}` path — use `git ls-remote` or the git-refs API to check branch existence.
- The gate-vs-rule reformulation is a reusable pattern for plot's other guardrails (the four phase guardrails are still rules): make completion depend on a real, pasted artifact rather than a claimable summary line — no hook required.
