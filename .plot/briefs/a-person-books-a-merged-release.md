## Implementation brief — a-merged-release-books-its-plans (wave 2: Repair)

- **Plan (canonical):** docs/plans/2026-11-24-a-merged-release-books-its-plans.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3702 merged
- **Branch:** `bug/a-person-books-a-merged-release` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `Review: pr` — the PR gets the `plot/review` status like every slice PR

Wave 1 (`bug/the-release-reading-names-unbooked-plans`, #3703) is merged: `releaseUnbooked`, the shared `releaseScope`, and fleetd's `release unbooked` finding exist on main. This slice waits on that and nothing else. Wave 3 (`bug/the-release-finish-leaves-a-record`) waits on this slice and adds the record file and the row's `last finish:` text. Wave 4 (`bug/reconcile-counts-unbooked-docs-plans`) is independent of this slice.

### What to build

Release PR #3598 (`release: 2.36.0`) merged on 2026-11-23 and the finish booked no plan and closed no sprint. A person booked 20 plans by hand over two hours. `finishRelease` already does the repair when it runs again, but no place shows the debt and nothing runs the finish except `release-approve` with a fresh merge. This slice gives a person that action.

Build four things on top of what exists:

1. **A version entry on `finishRelease`** (`packages/board/src/server/entry/release-finish.ts`). Today `finishRelease(ctx, prNumber, …)` reads the PR's `mergeCommit` from `host.prState`, then the version from `package.json` on the fetched default branch. The version entry takes a version instead: it normalises it to `vN.N.N`, fetches the default branch and the tag by their own refspecs, resolves the release merge commit from the tag (`<tag>^{commit}`, a local read, no host call), and passes it to `shippedChangesets`. Everything after that (booking worktree, `book`, `commitAndPush`, `tellTrackerAbout`) stays one code path. Do not copy the body; split the PR-specific head from the shared tail. The PR entry that `release-approve` calls (`main.ts:231`) keeps its behaviour and its signature for its caller.
2. **`POST /api/release-finish {"version":"2.36.0"}`** in `packages/board/src/server/index.ts`, next to `/api/release` and `/api/release-approve` (`index.ts:310-317`), running the version entry in the board's process. Refusals and the success answer follow the shape of the neighbouring handlers.
3. **`plot-ask.mjs release-finish <version>`** in `packages/board/src/server/entry/main.ts`, beside the `release-approve` arm. It refuses `PLOT_UNATTENDED=1` before it reads anything, prints a usage line and exits 2 on a malformed version, and exits 0 on `booked` or `already-released` and 1 on any other refusal. It takes no passkey assertion and carries none.
4. **The `unbooked` Delivery reason and row.** `delivery-placement.ts` places one `release` item per unbooked release under You › Unblock with reason `unbooked` (`YouReason` at `:151`; item kinds at `:37`; the release arm at `:465`). `delivery-row-form.ts` renders `unbooked · <version> · <n> plans`, names the plans, and carries a "Book as Released" action (reason text lives near `:899`). The board component calls `POST /api/release-finish` and shows the refusal's reason in place, as `ReleaseApprove.tsx` does for its message. The placement, the row text and the button's enabled state are domain properties, asserted in unit tests.

Where the board gets `releaseUnbooked`'s answer: wave 1 publishes it as the `release unbooked` finding (`attention.ts:86`, `ReleaseMonitor`). The plan's open question `[question-board-reads-without-fleet]` recommends that the board asks the rule itself from the same local readings when no fleetd heartbeat is live, as it does for the PR reader. Follow that recommendation, reuse the reading code from `packages/fleet/src/shared/release-world.ts` rather than writing a second reader, and say in the PR body which of the two sources the row used in your run.

### Decisions the plan settles — do not re-derive them

- **No passkey.** The passkey binds a merge that cannot be undone to a person. This finish writes plan records and a sprint close in one revertible commit, as `plot-deliver.mjs --release` already does per plan. `releaseFinish` refuses `unattended` and `fleetd`; the gate refuses an agent's HTTP call; the command refuses `PLOT_UNATTENDED=1`. Do not add `person-unproven` or an assertion field to this route.
- **The gate has no receipt escape for the HTTP form.** Add `/api/release-finish` to `API_ROUTES` (`packages/domain/src/rules/controller-gate.ts:207`), to `GatedAction` and to the final-refusal arm in `gate.ts` (`:1003-1012`), next to `needs-design`, `supersede` and `story-status`. The refusal names `plot-ask.mjs release-finish <version>` as the route. The command form is not gated, as `merge` is not. `/api/release` is a prefix of `/api/release-finish`: check how `controllerHttpAction` already tells `/api/release-approve` from `/api/release` and follow it, so that a POST to the new route reads as `release-finish` and never as `release`.
- **Scope is `releaseScope`, shared with `releaseUnbooked`.** Wave 1 already makes `releaseFinish` read closed sprints. Do not add a second scope function, and do not change `releaseFinish`'s refusal set in this slice.
- **A second call answers `already-released`.** That is exit 0 and the HTTP answer reports it as done, not as a failure.
- **The finish does not wait for a tag that is not there.** The version entry runs after a merge, so the tag is expected. Where it is absent after one fetch, the finish refuses `tag-absent` and writes nothing. Pass a zero wait; do not reuse `Checks wait` here.
- **`released` plans with no `Released:` record stay out of this slice's scope.** Only plans that read Delivered are owed (`releaseOwed`).
- **The record file is wave 3.** Do not write `.plot/state/release-finish/<version>.json` here, and do not render `last finish:` here.
- Rules carried over: absent is not false (an unreadable read answers `unaskable` and the row shows no `none`); read the exit code, not the emptiness; the index never says no, and no verdict is persisted ("Answers, never verdicts").

### Done when

The plan's `## Slices` line for this branch is the specification: placement puts an unbooked release under You › Unblock with reason `unbooked`; the route books a closed sprint's plans and answers `already-released` on a second call; the command refuses `PLOT_UNATTENDED=1`; the gate refuses `curl -X POST …/api/release-finish`.

Lift these assertions, because a naive implementation passes without them:

- **A POST to `/api/release-finish` refuses with a fresh receipt present, from a linked worktree and from the main checkout.** It catches an implementation that adds the action to the receipt check only. See `controller-gate-readings.test.ts` for the shape.
- **A POST to `/api/release-finish` does not read as `release`.** It catches the prefix match.
- **A read-only mention (`grep release-finish docs`, a heredoc body) and `plot-ask.mjs release-finish 2.36.0` still pass the gate.** It catches a match that is too loose.
- **A release whose plans are all `Released` but whose sprint is open still shows the row** with the sprint and zero plans: `releaseUnbooked` answers `sprintOpen`, and the booking closes it. The finish returns `already-released` only where nothing remains, including the sprint.
- **The 2.36.0 fixture:** two sprints name `Release: 2.36.0` (one closed), a `docs` plan is named only by a changeset, and the finish books it. It catches a path that books only the active sprint.
- **The version entry and the PR entry book identically** for the same release merge. It catches a copy of the shared tail that drifts.
- **An unattended or `fleetd` caller books nothing through either entry.**

Plus the repo gates. Add a changeset: description first, `bumps:` block last, `plan: docs/plans/2026-11-24-a-merged-release-books-its-plans.md` inside the block. The package is `plot` or `@plot-pm/board`; run `./scripts/check-changeset-packages.sh`. The board artifact is generated and stays out of the diff (`scripts/check-no-bundle-diff.sh`). Add a row for `plot-ask.mjs release-finish` where `skills/plot/scripts/README.md` lists the bundle's questions and actions, and update the `CLAUDE.md` sentence "Five actions run with no board…" to name `release-finish`; then run `./scripts/check-agents-md.sh --write`. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses growth: pay it back in the same change or write the rule in the domain. Prefer touching none. In `packages/domain/**` write arrow functions with factual TSDoc and no history; any function you write elsewhere is an arrow too.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/board/src/server/entry/release-finish.ts` (the version entry), `packages/board/src/server/entry/main.ts` (the `release-finish` arm), `packages/board/src/server/index.ts` (the route), `packages/board/src/server/entry/gate.ts` and `packages/domain/src/rules/controller-gate.ts` (the final refusal), `packages/domain/src/rules/delivery-placement.ts` and `delivery-row-form.ts` (the reason and the row), the board component for the button, and their tests.

Other branches in flight on the same plan: `bug/the-release-finish-leaves-a-record` (wave 3) edits `finishRelease` again to write the record, so keep the version entry small and shared-tail-shaped to leave it one place to write from. `bug/reconcile-counts-unbooked-docs-plans` edits `plot-reconcile-scan.sh` section 6 and the `releaseUnbooked` bundle call, not these files. Dispatch verifies other plans' branches touching `controller-gate.ts` or `delivery-row-form.ts` at claim time; if a collision appears at merge, report it rather than resolving it by taking a side.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
