## Implementation brief — reconcile-does-not-report-a-plan (wave 1: Double link)

- **Plan (canonical):** `docs/plans/2026-10-21-reconcile-does-not-report-a-plan.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2293 merged
- **Branch:** `bug/reconcile-does-not-report-a-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the plot-review app, per repo convention

This is the only branch of the plan. Nothing waits on it.

### What to build

`plot-reconcile-scan.sh` §1 reports no drift for a plan that has a symlink in both `docs/plans/active/` and `docs/plans/delivered/`. Observed on ewz-kus-portal: two Released plans (`bo-gp-sofort-nachladen`, `ewzkus-3845-gpsync-abloesen`) sit in both directories and the scan prints nothing for them (issue #2284).

Cause: every §1 arm in the drift `case "$st"` (about lines 1015-1045) tests one link present and the other absent (`in_active && !in_delivered`, or the reverse). A plan with both links satisfies no arm. §12 reports only a missing link, so it does not see the second link either.

Add one case ahead of the per-phase arms: `in_active` and `in_delivered` both non-empty. The phase decides which link is stale:

- `delivered|released|superseded|rejected`: remove the `active/` link.
- `draft|approved`: remove the `delivered/` link.

The line names the plan, the phase and both links. It prints `fix: git rm <stale link> && git add -A`. It increments `n_drift` like the other arms. The scan prints the command and runs none. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **No new section and no new summary field.** The case joins §1 and counts in `drift=`. A new section changes the `summary:` line that `/plot-deliver` and the `/plot` hygiene line parse, for no gain.
- **The fix is one `git rm`, not a `ln -s`.** Both links exist, so the right one is already in place. The existing arms print `git rm … && ln -s … && git add -A` because they move a link. Copying that shape here would try to create a link that exists.
- **The case must be exclusive with the existing arms.** The existing arms require exactly one link, so no plan matches two arms. Keep it that way, or one plan prints two drift lines.
- **Open question in the plan: phases outside the two lists** (for example `design`). The existing arms skip them. Report the double link for them without a fix command, as the plan proposes. A fix command there would pick a link by guess, and the scan's rule is that judgment stays with the person.
- **No fork per plan.** The loop reads `IDX_ACTIVE` and `IDX_DELIVERED` once, and a comment at the top of the loop records a 53.3 s sweep from a command substitution per plan. Write the case with `[ -n … ]` tests and `printf`/`+=` only.
- **Board impact: none.** Measured 2026-10-21 by grep over `packages/`, `skills/`, `test/` and `docs/`: the §1 drift wording appears only in `plot-reconcile-scan.sh` and `test/reconcile/scan.test.mjs`. No board view reads the §1 lines.
- **Absent is not false.** An empty `in_active` means "no link found in the index read", the same reading the existing arms use. Do not add a second filesystem check.

### Done when

The plan's slice line is the specification: a `test/reconcile/` test builds a Released plan linked in both directories and a Draft plan linked in both, and asserts the drift line and the fix command for each.

Assertions a naive implementation passes without:

- **The fix removes the stale link and not the other.** Assert the Released plan's command names the `active/` link and the Draft plan's names the `delivered/` link. A fix that always removes `delivered/` passes a one-plan test.
- **The summary counts it.** Assert `drift=` rises by one per double-linked plan. A line printed without `n_drift` leaves the gate and the hygiene line blind.
- **No second line.** Assert the double-linked plan appears once in §1.
- **A one-link plan is unchanged.** The existing `scan.test.mjs` §1 tests (alpha) must still pass untouched.
- **A `design` plan with both links** prints the line and no `fix:` line.

Add the test as a new file `test/reconcile/scan-double-link.test.mjs`, with its own fixture, rather than extending the shared fixture in `scan.test.mjs`. That fixture's counts feed other assertions, and a new plan there shifts them. Write new helpers as arrow functions.

Plus: a changeset for the `plot` package, description first, `bumps:` block last, naming `plot-reconcile: patch`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This change adds lines to `plot-reconcile-scan.sh`, so pay for them in the same change: remove shell elsewhere in `skills/`, or fold the three arms' duplicated `drift_out` printing into fewer lines. The gate stores no number and has no override. Run it locally before the push.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` (§1 only), the new `test/reconcile/scan-double-link.test.mjs`, one changeset, and the `/plot-reconcile` SKILL.md or README only if it describes §1 drift cases. Other branches in flight on the scan script: none verified at dispatch; run `git log origin/main -3 -- skills/plot/scripts/plot-reconcile-scan.sh` before you start, and rebase if it moved.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
