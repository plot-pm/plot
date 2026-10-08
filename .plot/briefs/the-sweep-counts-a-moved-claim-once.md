## Implementation brief — the-tests-and-sweeps-leave-no-trace (wave 3: The sweep counts a moved claim once)

- **Plan (canonical):** `docs/plans/2026-10-07-the-tests-and-sweeps-leave-no-trace.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/the-sweep-counts-a-moved-claim-once` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Waves 1 and 2 have merged (#1354, #1385). This branch waits on nothing. Wave 4 (`bug/helpers-stay-out-of-the-board-package`) waits on it and touches `packages/board/build.mjs` and `packages/board/.gitignore`, so the two share no file.

### What to build

Section 14 of `skills/plot/scripts/plot-reconcile-scan.sh` (`double_claims=`) stops reporting two shapes that need no decision from a person.

The failure, measured 2026-10-07 on `a778bda0d` (issue #1343): the section reports 9 double claims. In all 9, every claimant plan is `Released`. In 3 of them, one listing line carries `<!-- deferred: moved to <plan> … -->`, so the plan gave the branch away and does not claim it. The other 6 are pairs of finished plans, where the section's own `resolve:` line asks a person to edit a plan that the plan-headings gate treats as history. A person reads 9 findings and none needs a decision.

The change is in the jq pass at `plot-reconcile-scan.sh:1859-1876` (the `jq -s -r` program), in two steps, in this order:

1. Drop a branch entry whose `deferred_reason` starts with `moved to`, **before** `group_by`. The parser already emits the field (`waves[].branches[].deferred_reason`, `plot-plan-meta.sh:677`; `""` where none was written).
2. After `unique_by(.slug)`, drop a group whose claimant plans are **all** terminal. The parser's `phase` is lowercase: `delivered`, `released`, `rejected`, `superseded` (`plot-plan-meta.sh:439`). `select(.phase != "NONE")` stays as it is.

Update the section 14 prose, the header entry at `:113-121` and the comment block at `:1795-1817`, so they state both skips. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Filter the moved listing before the grouping, never after.** A moved listing removed after `group_by` still raised the claimant count to 2 and the group would print. The case that distinguishes the two orders is one moved listing plus one live listing: filtered first, it has one claimant and is silent; filtered after, it reports as a collision.

**Match the prefix `moved to`, not the flag `deferred`.** `deferred: true` alone (a bare `<!-- deferred -->`, reason `""`) and `deferred: waits on X` still mean the plan holds the branch, so both stay claims. Only a reason that starts with `moved to` is a handover. Check the parser's actual `deferred_reason` text for the real listings in `2026-09-04-a-ref-is-not-a-claim.md:102` and `2026-08-31-the-registry-supervises-its-agents.md:482,486` before you write the pattern, and do not assume the reason is trimmed.

**"All terminal" means every claimant, not any.** A pair of one `Released` plan and one live `Approved` plan is a real collision: the live plan can still move the branch. The plan says "all", and a test asserts the mixed pair still reports.

**Terminal is four phases, not two.** Issue #1343 lists `delivered`, `released`, `superseded`, `rejected`. A test that only covers `released` passes an implementation that stops at `released`.

**The section reads the parser, never a second grep.** The claim set, the wave and the phase all come from `plot_json` of `plot-plan-meta.sh`. Re-deriving "is this plan finished" from a `State:` line here reproduces the defect section 14's own comment names. Do not add a second reader.

**The section still does not gate.** It stays below the `== blocking sections end ==` marker and `attention=` is unchanged. The existing tests *"a double claim leaves attention= unchanged"* and *"sits below the blocking-sections marker"* hold this; keep them green.

**Rules carried over unchanged.** An absent field is not a false one: `(.deferred_reason // "")` before `startswith`, so a plan from an older parser output does not abort the jq program (a jq error inside the process substitution would print `(none)` and read as a clean estate, the failure the `--slurp` comment names). One finding per branch, not one per claimant.

**Out of scope.** The step-3 annotations `moved:` and `split-from:` are not read by this change; the issue names only `deferred: moved to`. If a listing in the 9 uses another shape, report it rather than widening the filter.

### Done when

The plan's `## Done when` list is the specification. For this slice: *a fixture with one moved listing, one pair of released plans and one live collision prints `double_claims=1`*, and the test fails on `origin/main` today.

The assertions that exist because a naive implementation would pass without them:

- **A moved listing plus a live listing is silent.** Catches a filter placed after `group_by`.
- **A released plan plus an approved plan still reports.** Catches `any` in place of `all`.
- **A bare `deferred` and `deferred: waits on …` still count as claims.** Catches a filter on the flag instead of the prefix.
- **A pair of `delivered`, `superseded` or `rejected` plans is silent.** Catches a terminal set that stops at `released`.
- **The footer counter equals the body findings and the fixture's other sections stay clean.** The fixture's live collision must be the only `claimed by` line. Make the fixtures disagree: a fixture where the live collision is also the only possible finding passes a section that skips everything.

Add the cases to the section 14 fixture in `test/reconcile/scan.test.mjs` (`dcRepo`, `:1814-2012`), with every new plan linked under `plans/active/` or `plans/delivered/` so index drift stays silent. Plans at a terminal phase belong under `delivered/`.

Plus: a changeset in `.changeset/` for package `plot`, `patch`, description first, `plan:` and `bumps:` last (`skills: plot: patch`); run `./scripts/check-changeset-packages.sh`. Bump no version by hand. The slice touches no board file, so no rebuild.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. If a whole-file `scan.test.mjs` run stalls, run it with `--test-name-pattern 'section 14'` and read the summary line, not the exit code.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits a `.sh` file, so growth is paid for in the same change: keep the jq filter short, and remove an equal number of shell lines elsewhere in the change, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Run it locally and read its count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Write "Closes #1343" in the PR body.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` (section 14 and its prose), `test/reconcile/scan.test.mjs` (the section 14 fixture) and one changeset. Wave 4 holds `packages/board/build.mjs` and `packages/board/.gitignore`; waves 1 and 2 have merged. Verified at brief time: no commit on `main` has touched the scan or its test since the plan's approval commit `a778bda0d`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
