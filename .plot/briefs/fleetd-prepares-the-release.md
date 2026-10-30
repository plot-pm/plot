## Implementation brief — the-release-waits-for-one-approval (wave 2: Release preparation)

- **Plan (canonical):** `docs/plans/2026-10-29-the-release-waits-for-one-approval.md` on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2911 merged
- **Branch:** `feature/fleetd-prepares-the-release` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is wave 2 of the plan, and the wave it waits on has merged: `feature/the-release-is-approved-once` (#2951, `releaseApprove` and `RELEASE_BRANCH`) is on `main`. The two cross-plan dependencies the plan's Notes section names are merged too — `feature/fleetd-reviews-slice-prs` (#2958, `slicePrNext`, `startReview`) and `feature/the-loop-keeps-a-run-log` (#2938/#2899, the run-log port). Cut this branch from `main` now; nothing here is blocked.

### What to build

Today, once every plan in the sprint is Delivered, nothing acts on the release PR until a person or master agent finds it, checks its CI run, starts a review by hand, and watches for the right moment to approve. `release-approve` (wave 1) gives the person one action that merges, waits for the tag, and books the plans — but nothing yet decides *when* that action is ready, starts the review that `release-approve` requires, or tells the person the release exists. This wave builds that: a domain rule that reads the sprint scope and the release PR's state and picks one next step (wait, start the review, notify, or do nothing), wired into fleetd's existing loop the same way `slicePrNext`/`startReview` already wire into `auto-review.ts`.

Build, in this order:

1. **`releasePrepareNext(readings)` in `packages/domain/src/rules/`**, following `slicePrNext`'s shape (readings in, one step out — never a port, never `await`). Its readings: `sprintScope()`'s answer (`packages/domain/src/rules/sprint-scope.ts`) with each scoped plan's phase; the release PR's index row, specifically `plotReview`/`plotReviewSha` (`packages/domain/src/entities/pr-index.ts:110-123`); the required checks read by name (item 2 below); and the run-log lines for this release (`packages/domain/src/ports/run-log.ts`). A `sprintScope` reading of `{ read: 'none', ... }` holds — never treat an empty scope as vacuously ready. Every failed reading answers `unaskable` and holds; follow `pr-index.ts`'s own rule that the index never says "no release PR" — absence there means ask the host, not "none exists".
2. **Measure before building the `action_required` write.** `.github/workflows/release.yml`'s `dispatch-ci` job (`:160`) already starts `ci.yml` on the release PR's head. Check a recent release PR's head: does a green dispatched `validate` run alone let the PR merge, or does the pull_request-event run still sit at `action_required` (the comment at `release.yml:143-144` says it has, historically)? If a green `validate` is enough, build no write — `releasePrepareNext` just reads the existing `Build` port (`packages/domain/src/ports/build.ts`, adapters in `packages/domain/src/adapters/build/`) by check name instead of the folded rollup `checks-reading.ts`/`checks-verdict.ts` use elsewhere. If the `action_required` run is still required, the write is a Build-port addition in the TypeScript connector, pinned to workflow `CI`, event `pull_request`, branch `changeset-release/main`, the base repository and the head SHA, answering `unaskable` on Bitbucket and Jenkins.
3. **Start the review through `startReview`, never a bare role start.** `startReview(pr, head, opts)` is already exported from `packages/domain/src/adapters/review-start/review-start-node.ts` and already consumed by the fleet in exactly the shape this wave needs: `packages/fleet/src/shared/auto-review.ts` imports `slicePrNext`, `liveReviewRuns`, `readReviewStarts` and `startReview` together and wires them into the fleet's pass. `releasePrepareNext`'s "start the review" step feeds the same `startReview` call for the release PR's head. Only `reviewPr` (`packages/board/src/server/entry/review.ts:395`, write at `:512-515`) writes the `plot/review` status; a bare reviewer-role start writes none, so skipping `startReview` would make `release-approve` refuse `review-missing` on every head forever.
4. **Notify through `ports/notifier.ts`.** One message when the release first becomes ready (every scope plan Delivered); afterwards, one per new head only when that head's changeset list differs from the list on the last notification line in the run log. A head moved only by the changesets bot's version bump, with an unchanged changeset list, sends nothing. List the head's changesets in two groups — the sprint's scope plans, and outside work (a changeset from a plan outside the scope, or from no plan) — and never hold the release for the outside-work group; when every scope plan is Delivered, the release is ready regardless of what else rode the head.
5. **Record actions taken as run-log lines (#2899's port), never as a "ready" flag.** The record holds what fleetd did — review started at head X, notified at head X with changeset list L — so the next pass can compare. `release-approve` and the board never read "ready" from this record; they re-derive it fresh from the host, the same invariant `release-approve`'s `review-missing` refusal already depends on.
6. **A domain `releaseStage` value**: `waiting-scope`, `preparing`, `ready`, `merged`, `publishing`, `released`, `failed`. This drives the existing `release` row kind (`packages/board/src/contract/schema.ts`, the `release` row documented at `:1604`) and the approval button's disabled state. `RELEASE_BRANCH` already moved into the domain in wave 1 (`packages/domain/src/rules/release-branch.ts`) and the board already re-exports it (`schema.ts:2582`) — reuse that, do not re-add it.
7. **Wire into fleetd's loop** the same way `auto-review.ts` wires `slicePrNext` in: read `Auto-review`-style config if this needs its own gate, call `releasePrepareNext`, act on the step it returns.

### The decisions the plan settles — do not re-derive them

**The release PR stays outside the slice-loop arms.** The review arm (#2900), the merge arm (#2902) and the fixer (#2903) act only on slice PRs — `slicePrNext`'s guard already answers `none` for a branch outside the scope (confirmed in `packages/domain/src/rules/slice-pr-next.ts`). This wave's `releasePrepareNext` is a second, parallel rule for exactly one PR, the release PR; it does not extend `slicePrNext` to cover it; a HIGH on the release PR notifies the person and blocks `release-approve`'s `review-missing` gate, and no fixer starts.

**fleetd never merges and never runs the finish.** D4 and D7 (plan, Decisions section) are wave 1's territory and are already built: `release-approve` is the person's action, called through `plot-ask.mjs release-approve <pr> <sha>` or the board button, and it runs the tag wait and the batched booking as that person. This wave's job ends at "notify the person something is ready" — it starts no merge and books no plan.

**The scope is read once, through the existing reader.** D3: the scope is the active sprint file read from git at its latest commit, struck items excluded — `sprintScope()` (`packages/domain/src/rules/sprint-scope.ts`) and its git-backed adapter `packages/domain/src/adapters/sprint-scope-ref.ts` already do this. Build no second scope reader here.

**`plot/review` lives in the PR index now, read as `plotReview`/`plotReviewSha`/`plotReviewAt`.** These fields exist today (`entities/pr-index.ts:110-123`) and are present only alongside each other — never read `plotReviewSha` where `plotReview` is `'absent'`. `releasePrepareNext`'s "has the review already started/finished" check reads these, not a second file.

**Invariant carried from wave 1 and from the index rules generally: absent is not false.** A host or index read that fails answers `unaskable` and the rule holds; it never answers "no release PR exists" or "review not needed". Read the exit code / the explicit refusal name, never the emptiness of a result.

### Done when

The plan's `## Done when` / Changelog is the specification. Lift these assertions, which a naive implementation passes without:

- A scope read as `{ read: 'none' }` holds (`waiting-scope`), never "ready" — catches treating an empty/unreadable scope as vacuously satisfied.
- A scope where one plan is still Approved (not Delivered) holds — catches checking only that the scope is non-empty rather than checking every plan's phase.
- The review start step calls `startReview`, never the bare reviewer role — catches a rebuild that writes no `plot/review` status, which would make `release-approve` refuse `review-missing` forever.
- A head whose changeset list is unchanged since the last notification line sends no second notification — catches re-notifying on every changesets-bot version bump.
- A head carrying a changeset from outside the scope, with every scope plan Delivered, still reaches `ready` and still notifies — catches holding the release for outside work, which D1 (outside work) explicitly forbids.
- `releasePrepareNext` reads `plotReview`/`plotReviewSha` together — a `plotReview: 'success'` paired with a stale `plotReviewSha` (not the current head) is read as "review not yet on this head", not as a pass. Mirrors `release-approve`'s own `review-missing` check from wave 1.
- The `action_required` write (if item 2 above concludes it is needed) is pinned to the head SHA, not just the branch — catches approving a run against an older head that happens to share the branch name.
- The record written to the run log is actions-taken, not a boolean "ready" — a test asserting `release-approve` or the board derives readiness independently of this record, never from a cached flag.

Plus: a changeset for `plot` with the description first and the `bumps:` block last, and `plan: docs/plans/2026-10-29-the-release-waits-for-one-approval.md`. Never edit versions by hand. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice builds in TypeScript through a bundle; if any `.sh` file must grow, remove an equal amount of shell elsewhere in the same change — joining statements with `;`/`&&` is not a payment. The CI spawn ratchet (*One place reaches a process*, `allowed=28`) counts `spawn`/`execFile` in `packages/**/*.ts`: this slice reaches the host and notifier through ports and adapters, so the count must not grow. New domain code is arrow functions with factual TSDoc and no history in the comments; use `Slice`, never `Wave`, in new names — this brief's own "wave" is this plan's informal term for a fleet cohort, not a type to introduce.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `releasePrepareNext` and its tests under `packages/domain/src/rules/`; the `action_required`/required-checks-by-name Build-port addition, if item 2 concludes it is needed; the notifier wiring and the run-log record for release actions; the `releaseStage` domain value; the release row's stage and button in the board; and fleetd's wiring of all of the above into its loop.

Do not rebuild: `releaseApprove`, `RELEASE_BRANCH`, or the `merge()` refusal for release branches — all merged in wave 1 (`feature/the-release-is-approved-once`, #2951). Do not rebuild `slicePrNext`, `desk-dead`, or `startReview`/`review-start-node.ts` — merged via #2958. Do not rebuild the run-log port or `sprintScope`/`sprint-scope-ref.ts` — already on `main`. Do not rebuild the `plotReview`/`plotReviewSha`/`plotReviewAt` PR-index fields — already on `main`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
