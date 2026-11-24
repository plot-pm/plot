## Implementation brief — a-merged-release-books-its-plans (wave: Reconcile)

- **Plan (canonical):** `docs/plans/2026-11-24-a-merged-release-books-its-plans.md` on `main`
- **Approved:** 2026-11-24, jwloka, plan-PR #3702 merged
- **Branch:** `bug/reconcile-counts-unbooked-docs-plans` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This is the last wave. It waits on `bug/the-release-reading-names-unbooked-plans`, and that slice has merged (#3703): `releaseUnbooked` exists at `packages/domain/src/rules/release-unbooked.ts`, and the board already asks it through `ownUnbookedRead` (`packages/board/src/server/release-unbooked-reading.ts`). Waves *Repair* and *Record* touch the release finish and the Delivery tab, not the scan.

### What to build

Reconcile section 6 (`== 6. Delivered but already released`, `skills/plot/scripts/plot-reconcile-scan.sh`) misses a plan that the newest release owes when the plan's Type is `docs` or `infra`. Observed on 2.36.0: section 6 found 8 of the 9 sprint plans and missed `templates-show-named-identifiers` (slice #3615, in `v2.36.0`, named by a changeset in the release merge), because the loop does `case "$ptype" in docs|infra) continue ;; esac`. `releaseFinish` books every type, so the scan and the finish disagree on which plans a release owes.

Add an arm to section 6 that asks `releaseUnbooked` through a bundle and prints each owed plan whose Type is `docs` or `infra` and which still reads Delivered. The arm adds to `n_unrel`, so `unreleased_delivered=` counts it. Section 6 sits below the `== blocking sections end ==` marker, so the count gates nothing.

**Report only.** The arm prints `consider: /plot-release`-style guidance or the Delivery tab's "Book as Released"; it books nothing (Manifesto Principle 3: scripts collect and report).

### Decisions the plan settles — do not re-derive them

**Ask the rule; do not re-derive the scope in shell.** The scope is every sprint whose `Release:` names the version, active or closed, plus every plan a removed changeset names. A shell reimplementation would be a second, undeclared copy of `releaseScope` (see CLAUDE.md, *A Shell Script Asks The Domain*). The scan runs once per operator command, and a bundle answers in about 39 ms, so the cost rule says: call the domain. Reuse `ownUnbookedRead`'s readings (`releaseUnbookedReadingsFor` in `packages/fleet/src/shared/release-world.ts`) rather than building a fourth reader. Whether the bundle is a new entry (`plot-released-labels.mjs` is the model: `packages/board/src/server/entry/released-labels.ts`, registered in `packages/board/build.mjs`, with a `--section` mode) or a new question on `plot-ask.mjs` is yours to choose. State which and why in the PR. A new bundle needs the build registration and a row in `skills/plot/scripts/README.md`.

**The merge-commit test is not the answer.** Section 6 asks "which tag contains this plan's PR merge". A plan with no PR annotation, and every `docs`/`infra` plan, falls outside that test. The changeset and the sprint name what the release owes. Do not widen the `docs|infra` skip in the existing loop: `/plot-deliver` tells those authors "live on main — no release needed", and that message is true for a plan no release names. The new arm names only a plan that the newest release's scope names.

**No double report.** A non-`docs`/`infra` plan that the existing loop already reports must not appear twice. The new arm prints only owed plans of Type `docs` or `infra`; plans of other types stay with the existing loop. Test this: a `feature`-type plan owed by the rule is counted once.

**A failed read is not "none".** `releaseUnbooked` answers `unaskable` when any read fails, and `none` when nothing is owed. The arm prints `(not evaluated — <reason>)` for `unaskable` and stays silent for `none`. This is the rule the section's own `no PR annotation` arm states: "cannot tell" and "nothing wrong" must not look the same. An empty result read as "no findings" refused four merged plans on 2026-08-27 for the opposite mistake; carry the discipline in both directions.

**Offline.** The rule reads local git only (the changesets come from `git diff <tag>^1 <tag> -- .changeset`; no host call). The arm therefore runs under `--offline`/`--no-pr`, unlike the PR-annotation path. Keep that: the flag promises no git-host call and nothing here makes one.

**Newest tag only.** The plan's open question `[question-newest-tag-only]` recommends it; the rule reads only the newest tag. Older releases remain section 6's existing loop's job.

**Section number.** Keep it inside section 6. Do not renumber anything. No consumer reads a number: `/plot-deliver` reads to the marker line, and renumbering was measured to break 49 tests.

### Done when

The plan's `Reconcile` slice names the tests: a docs-type plan named by a removed changeset of the newest tag is reported; a docs-type plan named by no release stays silent. Add the cases a naive implementation would pass without:

- **A `docs` plan named only by a changeset and by no sprint is reported** — catches an implementation that reads sprints only.
- **A `feature` plan owed by the rule is not reported by the new arm** — catches a double count.
- **`unaskable` prints a not-evaluated line and does not print `(none)`** — catches silence read as health.
- **`--offline` still reports** — catches an arm placed behind the `PR_SOURCE` guard.
- **A `docs` plan already holding `Released:` stays silent** — catches an arm that ignores the phase and the record.
- **The footer's `unreleased_delivered=` includes the new findings, and `attention=` is unchanged.**

Put the test beside the other scan tests in `test/reconcile/` (model: `scan-index.test.mjs`, `reconcile-released-labels.test.mjs`) and build a fixture repository with a `v2.36.0`-shaped tag whose merge removes a changeset naming a docs plan.

Plus the repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; CI runs the suites in the `CI suites` key, and a failure there returns as a correction. List no full suite, and do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `plot-reconcile-scan.sh`, so growth is paid for in the same change: let the bundle print the formatted lines and keep the shell to one call and one loop, and remove shell elsewhere in the change if the count still grows. The gate counts commands, not lines. Joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. It stores no number and has no override.

Gates that also apply: `scripts/check-helper-table.sh` (a new bundle or changed script needs its README row; also update the `plot-reconcile-scan.sh` row's section 6 text), `scripts/check-bash32-syntax.sh` (no bash 4+ syntax), `scripts/check-no-bundle-diff.sh` (commit no rebuilt bundle; `main` builds them), and a changeset (`plot` package, `patch`, description first, `bumps:` block last, with `plan: docs/plans/2026-11-24-a-merged-release-books-its-plans.md`). Follow the arrow-function rule for any function you write in TypeScript.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the section 6 arm in `skills/plot/scripts/plot-reconcile-scan.sh`, the new bundle entry or `plot-ask.mjs` question and its build registration, the new test under `test/reconcile/`, the README rows, and the changeset.

The other three slices of this plan have merged: #3703 (reading), #3704 (Delivery row, button, route, `plot-ask.mjs release-finish`) and #3706 (finish record). Verified at dispatch, no open PR touches the scan. `main.ts` already carries `release-finish`; a new `plot-ask.mjs` question edits the same file, so a separate bundle is the lower-collision choice. Leave `releaseFinish`, `releaseScope`, `releaseOwed` and the Delivery files alone.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
