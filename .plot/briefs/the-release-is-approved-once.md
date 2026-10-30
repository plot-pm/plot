## Implementation brief — the-release-waits-for-one-approval (wave 1: Release approval)

- **Plan (canonical):** `docs/plans/2026-10-29-the-release-waits-for-one-approval.md` on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2911 merged
- **Branch:** `feature/the-release-is-approved-once` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave waits on two branches, both unmerged when this brief was written: `feature/unattended-callers-are-refused` (#2898, builds the `caller` reading) and `feature/merge-waits-for-a-settled-main` (#2902, the `default-branch-unsettled` hold in `merge()`). Cut the branch from `main` only after both merge. Wave 2, `feature/fleetd-prepares-the-release`, waits on this wave and builds `releaseStage` and the board button on top of the approval's outcome shape.

### What to build

A release today is a chain of hand steps. A person or master agent finds the release PR, approves its CI run, runs the review, merges, waits for publish, books each plan as Released and closes the sprint. The 2.29.1 release shows it: the sweep and sprint-close commits `860a0586a` and `c2349bd7c` went to `main` with no PR. The generic `plot-ask.mjs merge <pr> <sha>` also merges the release PR without reading `plot/review`, and a merged release PR publishes.

Build, in this order:

1. **`releaseApprove(readings, input)` in `packages/domain/src/workflows/`**, beside `merge.ts`. It returns `Outcome<…, Refusal>` the way `merge()` does. It refuses `unattended` (on the `caller` reading from #2898), `not-release-pr`, `head-moved` (the host's head, re-read fresh, differs from `<sha>`) and `review-missing` (`host.prReview(number).state` is not `success` on that head). On a pass it delegates to `merge()`.
2. **`RELEASE_BRANCH` moves into `@plot-pm/domain`.** It is `/^changeset-release\//` at `packages/board/src/contract/schema.ts:2590` today. The board re-exports it from the domain; `fleet.ts:5263`, `app/lib/agent-rows/rows.tsx` and `test/unit/tuple-row.test.ts` keep their imports working.
3. **The generic `merge()` refuses a `RELEASE_BRANCH` PR** with a refusal that names `release-approve`.
4. **The entry point `plot-ask.mjs release-approve <pr> <sha>`** in `packages/board/src/server/entry/main.ts`, beside the `merge` arm (`:151-178`). It reaches the merge through the existing `mergeAt` (`entry/merge.ts:48`), so the pinned merge, the check refusals and #2902's hold apply unchanged. `release-approve` joins `ControllerAction` (`packages/domain/src/rules/controller-gate.ts:12`) with a receipt shaped like `merge`'s, and `CLAUDE.md`'s list of board-free actions names it.
5. **The finish (D7).** After the merge, in the person's own call: wait for the tag of the version read from the release branch's `package.json`, bounded by `Checks wait`; book every scope plan as Released in one commit and one push, docs and infra plans included, with the sprint close in the same commit.

### The decisions the plan settles — do not re-derive them

**`release()` is not an unattended refusal and nobody on this branch builds one into it.** `release(readings, { unattended: true })` answers `decided` with plan-phase, plan-record, commit and push writes; `unattended` only turns the Should-Have prompt into a `PLOT-UNASKED` line (`workflows/release.ts:239-245`). The controller gate is a Bash hook and never sees fleetd's in-process calls (`entry/gate.ts:649-651`). So `release-approve` carries its own `unattended` refusal, read from #2898's `caller` reading. Do not add a second reading of `PLOT_UNATTENDED` here.

**No second merge rule.** `releaseApprove` refuses and then calls `merge()` through `mergeAt`. A copy of the check or head rules in the new workflow is what lets the two drift. `head-moved` appears in both on purpose: the approval's own re-read names the approved head, and `merge()`'s `sameCommit` pin still guards the write.

**`plot/review` is read fresh through `host.prReview`, never from the PR index.** The index never says no, and a merge cannot be undone. Absent, `failure`, or `success` on another sha all read as `review-missing`. Only `reviewPr` writes the status (`entry/review.ts:395`, write at `:512-515`); a bare reviewer role start writes none, so approval would refuse on every head.

**The existing `release` route cannot serve the finish.** `POST /api/release` takes one `slug` and one `version` (`server/release.ts:148-158`) and starts `plot-deliver.sh --release <version> <slug>` with its own push (`:211`). N plans make N pushes to `main`. `release()` already books many plans in one commit and one push (`workflows/release.ts:337-343`), but it skips docs and infra plans (`:291-294`) and answers `decided` with no write for a plan whose tag does not resolve (`:295-298`). The batched booking must cover docs and infra plans, and a scope plan that cannot be booked stops the finish before the push and is named.

**`plot-sprint-state.sh` commits nothing** (`skills/plot/scripts/plot-sprint-state.sh:22-25`). The caller owns the commit and the push, so the sprint close joins the booking commit; it does not get a second one.

**The finish is resumable and runs as the person.** `release-approve` on an already-merged release PR skips the merge and resumes the finish; `already-released` and `tag-absent` make a re-run safe. A release PR a person merged in the GitHub UI finishes the same way. `tag-absent` (`workflows/release.ts:275-279`) writes nothing and never re-runs publish. fleetd never runs the finish; the board button starts it detached, as `POST /api/release` does, so the single-threaded server never blocks. The push goes to `main` under the person's identity, as the 2.29.1 release did.

**Outside work never holds the release.** The scope is the active sprint file read from git at its latest commit, struck items excluded (D3, #2900's scope reader). This wave books the plans of that scope; a changeset from outside it changes nothing here.

Invariants carried from related work: absent is not false — a host read that fails answers `unaskable`, never "no release PR" and never "not review-missing"; read the exit code, not the emptiness.

### Done when

The plan's `## Done when` list is the specification (the plan on `main` carries the Changelog entries above as its acceptance). Lift these assertions, which a naive implementation passes without:

- `release-approve` on a non-release PR refuses `not-release-pr` and merges nothing. Catches a `RELEASE_BRANCH` test that is `includes` rather than the anchored prefix: `feature/changeset-release-notes` must not match (`tuple-row.test.ts:229-231` holds this).
- A head that moves between the person's read and the call refuses `head-moved` with the host's write count at zero. Catches pinning to the sha the caller passed rather than the fresh host head.
- `plot/review` `success` on an older sha with a new head refuses `review-missing`. Catches reading the status without its sha.
- An unattended caller refuses `unattended` before any host read. Catches a refusal ordered after the merge.
- `plot-ask.mjs merge` on the release PR refuses and names `release-approve`.
- The finish on an interrupted run (merged, tag present, nothing booked) writes one commit and one push. A second run answers `already-released` and writes nothing. Catches a booking that is not idempotent.
- A scope plan of type `docs` or `infra` is recorded Released. Catches reusing `release()`'s skip.
- A tag that is absent when the bound expires reports `tag-absent` and writes nothing.

Plus: a changeset for `plot` with the description first and the `bumps:` block last, and `plan: docs/plans/2026-10-29-the-release-waits-for-one-approval.md`. Never edit versions by hand. Update `CLAUDE.md` where it lists the board-free actions, then run `./scripts/check-agents-md.sh --write`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice builds in TypeScript through a bundle, so no `.sh` file should grow; if one must, remove an equal amount of shell elsewhere in the same change. Joining statements with `;` or `&&` is not a payment. The CI spawn ratchet (*One place reaches a process*, `allowed=28`) counts `spawn`/`execFile` in `packages/**/*.ts`: the finish reaches git and the host through ports and adapters, so the count must not grow. New domain code is arrow functions with factual TSDoc and no history in comments; use `Slice`, never `Wave`, in new names.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the new `releaseApprove` workflow and its tests under `packages/domain`; `RELEASE_BRANCH` and its re-export; the `merge()` refusal for the release branch; the `release-approve` arm in `entry/main.ts`, its entry file, and its gate receipt in `rules/controller-gate.ts` and `entry/action-receipt.ts`; the batched booking and the finish; the `CLAUDE.md` action list and its `AGENTS.md` mirror.

Other branches in flight: `feature/unattended-callers-are-refused` owns the `caller` reading and the `release`/`merge`/`continue` unattended refusals — consume it, do not rebuild it. `feature/merge-waits-for-a-settled-main` owns the `default-branch-unsettled` hold in `merge()`. `feature/fleetd-prepares-the-release` (wave 2) owns `releasePrepareNext`, `releaseStage`, the notification and the release row's stage and button; build none of them here. The reviewer role definition, the run log, the scope reader and `startReview` are owned by #2898–#2900.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
