## Implementation brief — delivery-reads-one-source (wave 1: Deliver reads the plan at the pulse ref)

- **Plan (canonical):** `docs/plans/2026-10-07-delivery-reads-one-source.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/deliver-reads-the-plan-at-the-pulse-ref` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the first of two waves. Wave 2, `bug/deliver-reads-the-pr-index-first`, waits on this one and edits `controllers/deliverability.ts`, a file this branch does not touch.

### What to build

`POST /api/deliver` refuses every Approved plan as `not-merged`, and refuses a plan that `origin` already delivered when the checkout is behind. Both come from `deliverability()` in `packages/board/src/server/deliver.ts` reading a different file and a different ref than the pulse it compares against (#1280, #1336).

**1. The slug resolves to the active symlink.** `resolvePlanBySlug` (`deliver.ts:147`) returns `docs/plans/active/<slug>.md` first. That path has no date prefix. `deliveryPulse` and `landed()` join on `basename(meta.file)` (`packages/domain/src/rules/deliverable.ts:133` and `:254`), and the pulse names plans by their dated file, `2026-10-07-delivery-reads-one-source.md`. The symlink's basename is `delivery-reads-one-source.md`, so `pulse.plans.find` finds nothing and `landed()` answers `not-merged`. Measured at `a778bda0d`: `docs/plans/active/delivery-reads-one-source.md` is a symlink to `../2026-10-07-delivery-reads-one-source.md`.

**2. The phase comes from the working tree.** `deliverability()` passes the resolved file to `planMetaSync`, which reads the checkout. The pulse is read from `origin/main`, whose name the fleet answer carries as `readRef` (`fleet.ts:8377`, from `entry.pulse.read_ref`). A checkout behind `origin` shows `Approved` for a plan `origin` shows `Delivered`, so the route offers a delivery that is already done.

The change: `deliverability()` resolves the real dated file in the plan directory and never the active or delivered symlink, and reads that file's phase with `git show <readRef>:<plan file>`. `landed()` and `deliveryPulse` then join on the dated basename with no edit of their own, because the file they receive now carries the name the pulse uses. A plan that `origin` delivered while the checkout is behind answers `already-delivered`. The plan is canonical; this brief adds what it leaves out.

### The decisions the plan settles — do not re-derive them

**Fix the deliver copy of `resolvePlanBySlug` and leave the other two.** The plan's notes record private copies in `approve.ts:120`, `commission.ts:117` and `deliver.ts:147`. The other two resolve the same symlink and are a candidate for one shared resolver. That is a separate refactor with its own diff: do not merge the three here, and do not edit `approve.ts` or `commission.ts`. Whether they need the dated file too is not measured here, so the PR names the two copies as a follow-up and says nothing about their behaviour.

**The phase is read at the pulse's ref, not at `HEAD` and not by a fetch.** A fetch inside a request handler spawns a process and changes what the route answers between two calls. `readRef` is already the ref the pulse was read from, so the verdict and the pulse describe one world. Reading the working tree is the defect.

**Do not re-derive the symlink-first order to "fix" the candidates.** The active index first, then the delivered index, then the dated file is the order `plot-approve.sh` uses, and `transition.ts` keeps it. The route needs a file whose basename is dated. Resolve through the symlink to its target (`fs.realpathSync`) or find the dated entry in the plan directory directly; either gives the dated basename. Pick one, test both layouts below, and state the choice in the PR. A plan already moved to `docs/plans/delivered/` must still resolve: a plan being delivered may already have moved.

**Rules carried over unchanged.**

- **Absent is not false.** `readRef` is `null` when the scan sent none (`fleet.ts:8370` states why it is not substituted). With a null read ref there is no pulse to compare against, so read the phase from the working tree as today. Never answer `already-delivered` or `deliverable` from a ref that was not named. A test pins this.
- **A `git show` that fails is "cannot read", never "not delivered".** A ref that does not hold the file, a missing ref and a git error all fall through to the working-tree read. They never produce `already-delivered`, and they never produce `not-found` for a plan that exists on disk. Read the exit code, not the emptiness of the output.
- **`allSlicesConfirmed` stays.** Do not change the three-way `merged` / `unknown` / `not-merged` mapping or `deliveryPulse`'s choice of pulse; #1113 measured why. This branch changes which file and which phase the rule is handed.
- **The domain takes readings as values.** `deliverable.ts` imports no port and spawns nothing. The `git show` belongs in the board's server layer or behind the existing `Refs` port, never in `packages/domain/src/rules/`. A function you write or rewrite is an arrow.

### Done when

The plan's `## Done when` list is the specification. Each test fails on `origin/main` today.

- A deliver-route test resolves a plan through `docs/plans/active/` and answers `deliverable` for a plan whose slices all merged.
- A second test holds the plan `Delivered` at the read ref and `Approved` in the working tree, and answers `already-delivered`.

Assertions that exist because a naive implementation passes without them:

- **The fixture's pulse names the dated file.** `deliver-route.test.ts` writes its plans as dated files in `docs/plans/` with no `docs/plans/active/` directory (`:63-80`), so no existing case reaches the symlink branch and none can show #1280. Add `docs/plans/active/<slug>.md` as a symlink to the dated file, name the dated file in the pulse, and show the test fails when `resolvePlanBySlug` returns the symlink. Run it against the unfixed source before you believe it.
- **The stale-checkout test uses two different phases in two places.** Put `Delivered` in a commit at the read ref and leave `Approved` in the working tree. With both `Approved`, or both `Delivered`, the test passes with the working-tree read still in place.
- **A null read ref keeps today's answer.** Without this test, a change that throws or answers `not-found` on `readRef: null` passes everything else and breaks every cold start.
- **A plan under `docs/plans/delivered/` still resolves.** Without it, resolving to the dated file by directory listing drops the delivered-index candidate and a delivered plan answers `not-found` instead of `already-delivered`.

Plus: a changeset for `'@plot-pm/board'` as `patch`, with the description first and the `bumps:` block last, and a `plan: docs/plans/2026-10-07-delivery-reads-one-source.md` line inside that block. `./scripts/check-changeset-packages.sh` checks the form. The change is under `packages/board/`, so main rebuilds the shipped bundles after the merge: do not commit a generated bundle (`scripts/check-no-bundle-diff.sh`), and run `pnpm build:board` only to test locally, then restore generated paths from the merge base.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 24 (`nvm use`). Never run board tests while the operator's board is open: use the `vitest related` command the local checks print, not `pnpm test:board`.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. If you find yourself editing one, the growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names: which resolution you chose and why, the three tests that fail on `main` and the unfixed run that proved it, the null-read-ref behaviour, and the two `resolvePlanBySlug` copies left for a follow-up.

### Scope guard

This branch owns the deliver route's plan lookup and phase read:

- `packages/board/src/server/deliver.ts` (`resolvePlanBySlug`, `deliverability`)
- the read of a file at a ref, in the board's server layer or through the `Refs` port, if no existing method answers it
- `packages/board/test/unit/deliver-route.test.ts` and `delivery-reads-the-last-finished-scan.test.ts`, for the new cases
- one changeset under `.changeset/`

Not this branch's: `packages/board/src/server/controllers/deliverability.ts` and `mergedBranches` (wave 2, `bug/deliver-reads-the-pr-index-first`), `approve.ts`, `commission.ts`, `transition.ts` and `reslice.ts` (their own copies of `resolvePlanBySlug`), and `packages/domain/src/rules/deliverable.ts` and `eligible.ts`, whose rules already answer correctly once handed the dated file.

Other branches in flight, checked 2026-10-07 with `git ls-remote --heads origin`: `main` and three `plot/approve-*` plan-approval branches, none carrying code. The other three plans of the release-train split (`the-fleet-loop-reads-its-runs-right`, `a-controller-owns-what-it-starts`, `the-tests-and-sweeps-leave-no-trace`) run in parallel with this one. If a rebase shows a conflict in `deliver.ts`, stop and report it rather than resolve it by taking a side.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
