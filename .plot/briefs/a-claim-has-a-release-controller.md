## Implementation brief — a-controller-owns-what-it-starts (wave 2: A claim has a release controller)

- **Plan (canonical):** `docs/plans/2026-10-07-a-controller-owns-what-it-starts.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-claim-has-a-release-controller` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave waits on wave 1, `bug/continue-owns-the-desk-it-starts`, which merged as #1351 (`9c344e414`). Cut the branch from `main` at or after that commit. `every-loop-ending-has-a-supervisor-rule` slice 1 (`infra/an-ending-that-held-nothing-releases-its-claim`) waits on this wave: the registry tick of that slice calls `releaseClaim`, so the function's signature is the contract it builds on.

### What to build

A master agent that must give a stale claim back to the queue has no controller to ask. The only door is `plot-dispatch.sh --release <branch>`, and `plot-controller-gate.sh` counts that as a bypass (`--unowned-action`) — issue #1276. `CLAUDE.md`, *The Master Agent Uses The Controllers*, names such a gap as the finding: the fix is a controller, not a better-documented bypass.

Build three things, in this order:

1. **`releaseClaim` in the domain.** A workflow beside `stopWorker`, `restartWorker` and `migrateWorktrees` in `packages/domain/src/workflows/dispatch-verbs.ts`. It takes the branch and the readings of its agent and its PR, and returns `Outcome<…, Refusal>` the way `stopWorker` does: a decision with a `release` write, or a refusal. The plan names two refusals, `agent-live` and `pr-open`. Arrow function, TSDoc that states behaviour and not history (`CLAUDE.md`, *The Domain Package*).
2. **`POST /api/release-claim {branch}`** in `packages/board/src/server/`, one file beside `drop.ts` and `continue.ts`, registered in the route table in `packages/board/src/server/index.ts` (the table beside `/api/continue`). It reads the readings, calls `releaseClaim`, and on `release` runs the release through an adapter. It answers 409 with the refusal reason on a refusal.
3. **`plot-ask.mjs release-claim <branch>`**, reaching the same controller without HTTP. See the first settled decision below: this is not a one-line addition.

### The decisions the plan settles — do not re-derive them

**Refuse a live agent; do not stop it and then release.** The plan's open question asks this for slice 1 and answers *refuse*, and #1351 shipped it as `loop-alive`. `--stop` keeps the claim on purpose ("stopping is not abandoning", header of `plot-dispatch.sh`). A release that also stops would merge two acts the script keeps apart, and a stop can lose a turn in progress.

**`plot-ask.mjs` has no action mode today.** `packages/board/src/server/entry/ask.ts` answers three questions (`board`, `fleet`, `deliverable`) and `questionFrom` in `entry/main.ts` knows only those. `CLAUDE.md` says the nine controller actions are "reachable without HTTP through `plot-ask.mjs`", and that holds for their availability flags and not for performing them. Measured at `3e22a1613`: `grep "release-claim\|releaseClaim"` over `packages`, `skills` and `docs` hits only the two plan files. So the third deliverable adds a new command path to the entry. Keep it small: parse the branch, call the same controller function the route calls, print the outcome, and exit non-zero on a refusal. Do not add a general action dispatcher; report it if you think one is owed.

**Do not reimplement `--release`'s six refusals in TypeScript.** The shell verb (`plot-dispatch.sh`, the `release` block) refuses on: a PR in any state or a host that cannot be asked; a live agent holding the branch (`claim_answer`, which already goes through the domain's `claimAnswer`); a live worker pid; a file-changing commit on `origin/<branch>`; unpushed or dirty work on the desk; a `PLOT-BLOCKED` marker. It clears the manifests first and the ref second, and it detaches the desk afterwards. The plan's two domain refusals are the ones the controller can decide from readings it already owns; the adapter keeps calling the script, so the remaining four stay enforced there. **A script refusal must reach the caller as a refusal.** Exit 1 from the script becomes 409 with the script's own sentence. A 200 on a script refusal reports a release that did not happen — the `trackerNone` reasoning in `CLAUDE.md`, *The Layering Rule*.

**The script is reached from an adapter and nowhere else.** Layering: controller → domain → port ← adapter → script. The route never spawns; it asks a port the domain owns, and a new adapter method runs `plot-dispatch.sh --release`. `scripts/check-script-names.sh` and the CI spawn ratchet (*One place reaches a process*, `allowed=28`) will see a direct `spawn` in the route. The count must not grow.

**`stopWorker` and `restartWorker` are the same shape and have no caller outside tests** (`grep` over `packages` hits only `dispatch-verbs.ts` and `workflows-dispatch-verbs.test.ts`). That is the "a rule exists and nothing calls it" defect `CLAUDE.md` tells you to report, not to fix here. Do not wire them in this branch; mention them in the PR body.

**`/api/release` is a different act.** It cuts a version release (`plot-deliver.sh --release`). Name the new route `release-claim` and keep `controllerInvocation` (`packages/domain/src/rules/ci-suite`) as it is unless a test forces a change; the gate's token loop covering `--release` of `plot-dispatch.sh` is outside the plan. If you find the gate should now point at the new route in its refusal text, report it rather than widen the slice.

**Rules carried over from related work:**

- Absent is not false. A PR reading the host could not answer is `unknown`, and `unknown` refuses (`--release` says: "a release deletes a ref that cannot be re-created, so silence is not permission"). The index supplies `MERGED` and never `none` (*A Decision Reads The Index*).
- Read the exit code, not the emptiness of the output.
- A merged PR refuses too. The shell treats `MERGED` and any `mergedAt` as `pr-open`'s sibling: the ref belongs to `plot-release-refs.sh`. Decide in `releaseClaim` whether `pr-open` covers it or a third reason is needed, and say which in the TSDoc.
- A new controller route joins `WRITE_ROUTES` in `packages/board/test/write-gate.test.mjs`; that test reads the server's table back and fails on a write route absent from its list.
- The board's `Board` capability flags (`askedWithoutTransport` in `entry/ask.ts` lists them) are a closed set. Add a `release-claim` flag only if the app needs to show a button; the plan asks for none, so default to adding none and say so.

### Done when

The plan's `## Done when` list is the specification:

- `releaseClaim` refuses `agent-live` and `pr-open` and answers `release` otherwise. Each test fails on `origin/main` today because the function does not exist.
- `plot-ask.mjs release-claim <branch>` removes the claim ref.

Assertions that exist because a naive implementation passes without them:

- **A script refusal is a refusal.** Stub the adapter's script call to exit 1 and assert the route answers 409 and the outcome is not `release`. Catches a route that treats "the script ran" as "the claim is released".
- **`agent-live` reads the manifest's own desk.** A manifest naming the branch whose desk is alive refuses even when `origin/<branch>` does not exist. Catches a rule that reads only the ref (the measured case in `--release`: an agent just handed the branch has not checked it out).
- **`unknown` refuses.** A host that cannot be asked, and a PR reading of `unknown`, both refuse with nothing written. Catches `unknown` read as `none`.
- **A branch that holds no claim answers success with nothing to do.** The script exits 0 with "Nothing to release"; the controller must not turn that into an error.
- **The released slice is claimable again.** After `release`, `claimedBranches` no longer lists the branch and no manifest names it. This is the two-records property the script's header measures (2026-09-26, `feature/the-board-filters-to-my-work` handed out twice).
- **The CLI path and the route share one function.** One test asserts both reach `releaseClaim` with the same readings; a second copy of the decision would drift.

Plus the repo gates: a changeset in `.changeset/` with the description first and the `bumps:` block last, package `@plot-pm/board` (see `.changeset/continue-owns-the-desk-it-starts.md`), with `plan:` set to this plan's path; run `./scripts/check-changeset-packages.sh`. The branch carries no built bundle (`scripts/check-no-bundle-diff.sh`); `main` rebuilds after the merge. Domain code is `packages/domain/src/**` — `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and the domain tests apply, and the root `pnpm run typecheck` does not cover that package.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file: the adapter calls the existing `--release` verb. If you find you must change the shell, pay for the growth in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

Push the first real commit as soon as it exists. The claim ref already carries only an empty claim commit; a pushed commit tells the fleet the slice has work.

### Scope guard

This branch owns:

- `packages/domain/src/workflows/dispatch-verbs.ts` and its test `packages/domain/test/workflows-dispatch-verbs.test.ts`, plus a port under `packages/domain/src/ports/` and its adapter under `packages/domain/src/adapters/` if the existing ports do not carry a release verb.
- A new route file in `packages/board/src/server/`, its entry in the table in `packages/board/src/server/index.ts`, its unit test in `packages/board/test/unit/`, and the `WRITE_ROUTES` row in `packages/board/test/write-gate.test.mjs`.
- The `release-claim` command in `packages/board/src/server/entry/main.ts` and `entry/ask.ts`.
- The changeset, and the `→ #<number>` annotation in the plan.

Branches in flight, checked at `3e22a1613`:

- Wave 1 `bug/continue-owns-the-desk-it-starts` merged (#1351). It touched `packages/board/src/server/continue.ts`, `packages/domain/src/rules/desk-loop-alive.ts` and `ContinueWithAnAnswer.tsx`. Do not edit them.
- `infra/an-ending-that-held-nothing-releases-its-claim` (plan `every-loop-ending-has-a-supervisor-rule`, slice 1) waits on this branch and will edit `registryd-main.ts` and the ending rules. Do not edit `packages/board/src/server/entry/registryd-main.ts`. Do not add the `nothing-done` ending or `endingAction` rows here.

If you find something the plan did not anticipate — the missing action mode in `plot-ask.mjs`, the unwired `stopWorker` and `restartWorker`, the gate's coverage of `--release` — report it rather than improvising outside scope.
