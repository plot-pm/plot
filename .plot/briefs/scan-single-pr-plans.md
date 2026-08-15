## Implementation brief — reconcile-scan-accuracy, branch 1 of 3

- **Plan (canonical):** `docs/plans/2026-08-15-reconcile-scan-accuracy.md` on `main`
  — https://github.com/plot-pm/plot/blob/main/docs/plans/2026-08-15-reconcile-scan-accuracy.md
- **Approved:** 2026-08-15, jwloka, plan-PR #101 merged
- **Branch:** `bug/scan-single-pr-plans` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Wave:** Section 2 — `bug/scan-contained-in-pr` is blocked until this merges,
  because both edit `plot-reconcile-scan.sh`.

### What to build

Section 2 of `plot-reconcile-scan.sh` (the merged-but-not-delivered check,
around line 396) must also find plans whose implementation rode their own idea
branch.

**Why today's check misses them.** Around line 403:

    for b in $branches; do
      if printf '%s\n' "$merged_branches" | grep -qx "$b"; then merged_any=1; fi
    done

`$merged_branches` comes from `git branch -r --merged`. A single-PR plan names
its idea branch, which is deleted at merge — so the ref is gone and the match
can never succeed. The check looks for the right thing in a place where it
cannot be.

**Do not reach for the plan's `prs` field.** It is the obvious fix and it is
wrong: `kanban-board-v1`, the plan that motivated this work, carried **no PR
annotation** while it sat undelivered for five weeks. `→ #40` was back-filled at
delivery time. The missing annotation and the missing delivery share a cause, so
an annotation-dependent fix is blind to exactly the plans it exists to catch.

**Build this instead.** Fetch merged PRs once, bundled, and match plan branches
against their heads:

    plot-host.sh pr-list --state merged    →  number, head   (one call for all plans)

A plan in phase `approved` whose named branch matches a merged PR head is
merged-but-not-delivered — regardless of whether the ref still exists or the
plan ever recorded a number.

**Cost is measured, not assumed.** `pr-state` costs 0.61 s *per call*; the
bundled `pr-list --state merged` costs 0.63 s *per run*. Same price, constant
instead of linear — which is why no flag is needed. Put the fetch beside the
existing bundled open-PR list (`open_prs`, around line 155) and inside the same
degradation path: `--offline` / `--no-pr` skip both, and `PR_SOURCE` already
records which happened.

The two signals are **OR-ed, not replaced**. Fan-out plans keep the existing
branch check unchanged — their PRs are per-branch and may merge at different
times.

### Open question you will have to settle

**What `--limit` does the merged-PR list need?** A probe for `kanban-board-v1`'s
merged PR came back empty at the default limit. Too low silently misses old
plans — which is this plan's own failure mode — and too high costs latency on
every run. Pick a number, say why in the PR, and make the truncation visible
rather than silent if the list hits the limit.

### Done when

- A fixture repo reproduces the single-PR shape (plan on an idea branch, PR
  merged, branch deleted) and the scan reports it in section 2.
- Fan-out plans still behave exactly as before — the existing section-2 tests
  stay green without modification.
- `--offline` / `--no-pr` degrade cleanly: no network call, and the finding is
  either skipped or marked as unverifiable rather than silently absent.
- Tests extend `test/reconcile/scan.test.mjs` (it already exists).
  **Assert per line, not with a whole-output regex** — this suite has been
  fooled three times by patterns matching across report lines or the summary
  footer.
- `pnpm test` and `pnpm run test:reconcile` pass.
- A changeset is present (`pnpm changeset`) — this changes a skill script, so
  the plugin version bumps per CLAUDE.md › Versioning.
- macOS ships bash 3.2: **no `declare -A`**, no bash-4-only constructs. A test
  already enforces this across all scripts.
- Board impact: **none**. `packages/board` does not read this script, so
  `skills/plot/scripts/board/board-server.mjs` must not change. If a rebuild
  produces a diff, something is wrong.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section (under `### Section 2`) on `main`. Note the irony: the
missing version of exactly this annotation is what this branch exists to work
around.

### Scope guard

Section 2 only. The containment fix (section 3) is `bug/scan-contained-in-pr`
and is deliberately blocked behind this branch — they edit the same file. The
board-script test is `feature/update-board-test`. Drift → back to the plan.
