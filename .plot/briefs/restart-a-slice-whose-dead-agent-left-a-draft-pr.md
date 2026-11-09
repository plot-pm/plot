## Implementation brief — restart-refuses-a-slice-whose-dead

- **Plan (canonical):** docs/plans/2026-11-09-restart-refuses-a-slice-whose-dead.md on main
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3294 merged
- **Branch:** `bug/restart-a-slice-whose-dead-agent-left-a-draft-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

One slice, one branch. Nothing waits on it except five Delivery tab slices, which wait on the outcome rather than on a merge.

### What to build

Today `restart` reads any open PR as "the work reached review". Measured 2026-11-08/09 on `feature/delivery-tab-sections` (PR #3267, draft, body "first slice only"): its agent ended, the PR stayed an incomplete draft, and every route refused (`reached-review`, `no-worktree`, `no-question`, `implement-started` with no worker). A draft is not in review: no reviewer or merge acts on it. The fix makes `plot-restart-command.mjs` start a new agent on a slice whose PR is a draft and whose worker is dead, and keeps `reached-review` for a non-draft open PR.

Three places change, and the second is the one a naive fix misses.

1. **Carry the flag.** `adapterReaders().pr` in `packages/fleet/src/shared/restart-command.ts:67-75` reads `hostShell(...).prState(branch)`. That value is a `Pr`, and `Pr.draft` (`packages/domain/src/entities/pr.ts:61`) is already there. `BranchPrReading` (`packages/domain/src/workflows/dispatch-verbs.ts:45-62`) has no `draft` field; add one and fill it from the reading. Offline, no PR and unanswerable readings carry `draft: false`.
2. **Do not tell the worker-state reader the work reached review for a draft.** `restartBranch` calls `readers.worker(worktree, pr.reachedReview === true)` (`restart-command.ts:139`). That second argument becomes the `pr` fact of `plot_worker_state`, and a clean desk with a PR reads `finished` (`plot_worker_task_state`, `plot-worker-state.sh:1136`). `restartWorker` then refuses `worker-finished`. So fixing only the `reached-review` refusal moves the same slice from one refusal to the next. Pass `true` only for a PR that is open and not a draft, or merged.
3. **Refuse in the domain.** `restartWorker` (`dispatch-verbs.ts:208-220`, not `dispatch.ts` as the plan says; `DispatchRefusal` is declared in `dispatch.ts:36`) refuses `reached-review` when `readings.pr.reachedReview` is true. Make it refuse only when the PR is not an open draft. A merged PR still refuses: `reachedReview` stays true for it, and a draft flag on a merged PR must not matter. The decision stays in the domain per the layering rule; the controller passes the flag as a reading.

Then the restart prompt. `RESTART_ANSWER` (`restart-command.ts:19`, used at `:162`) is a constant and says only "Read the brief, the tree and `git log`". The plan settled that a draft-PR restart also names the PR number and tells the agent to read the PR body and finish its Not done list. Turn the constant into a function of the reading (keep the exported name's no-PR text byte-identical for the no-PR case so existing tests and callers do not move).

### Settled by the plan — do not re-derive

**The fleet reading does not change.** `startability: someone-is-on-it`, `group: quiet` stays as it is. The `quiet` row already tells a person nobody is on the slice; what was missing is a controller that acts on it. A fleet reading change is out of scope.

**The other refusals stay.** `loop-alive`, `worker-alive`, `worker-finished`, `blocked-marker`, `unattended`, `pr-unanswerable`, `branch-missing`, `no-worktree`. The draft exception sits only on the PR question. Order stays: the PR is asked first, before the state word (the comment at `dispatch-verbs.ts:49-58` is a measurement: five of five `failed` worktrees held a PR).

**An unanswered question is not "no PR", and "no draft flag" is not "a draft".** `unanswerable` still refuses `pr-unanswerable`. If the host answers a PR without a draft reading, treat it as not a draft; a restart that guesses draft would replace an agent whose work is under review.

**No new `--force`.** The existing comment on `restartWorker` explains why.

### Done when

The plan has no `## Done when` list; its one slice line is the specification: carry the PR's draft flag into the restart decision, refuse `reached-review` only for a non-draft open PR, and cover both a draft PR with a dead worker (restarts) and a non-draft open PR (refuses `reached-review`). Assertions to lift, each because a naive fix passes without them:

- **A domain test in `packages/domain/test/workflows-dispatch-verbs.test.ts`** (the existing `reached-review` cases are at `:114-128`): draft open PR with a dead worker decides `worker-start`; non-draft open PR refuses `reached-review`; merged PR with `draft: true` refuses `reached-review`; the `reached-review`-before-`loop-alive` ordering test (`:122`) still holds for a non-draft PR. Catches a fix that tests only the happy arm.
- **A controller test in `packages/fleet/test/unit/restart-command.test.ts`** that runs `restartBranch` end to end on a desk with a draft PR and a dead worker through a reader whose `worker` returns `finished` when called with `hasPr = true` and `failed` when called with `false`. It must restart. Catches the `worker-finished` trap in item 2; with a stub that ignores `hasPr`, the test passes against the broken fix.
- **A prompt test:** the draft-PR restart's answer names `#<number>` and "Not done"; the no-PR restart's answer equals today's `RESTART_ANSWER` text. Catches a prompt change that leaks into the plain restart.
- **An adapter test** beside the offline ones (`restart-command.test.ts:99-111`): the reading carries `draft` from `prState`. If no host stub exists for an `ok` answer, add the smallest one rather than skipping this.

Plus: no `plot-*.sh` is in scope, and no generated bundle goes into the PR (`scripts/check-no-bundle-diff.sh`); `main` builds them. Add a changeset for package `plot` with the description first and the `bumps:` block last; the plan's `## Changelog` line is the description. If you touch a `.sh` file, `scripts/check-shell-lines.sh` refuses growth: remove shell elsewhere in the same change. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

Arrow functions for every function you write; TSDoc states behaviour, not history; the history goes in the commit message.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/fleet/src/shared/restart-command.ts`, `packages/domain/src/workflows/dispatch-verbs.ts`, their tests, and one changeset. Verify before editing, because the brief did not: `plot-dispatch.sh` holds its own `reached_review()` (`:1694`, OPEN or MERGED) used by `worker_state()` and a `--restart` arm (`:1836`, `:1895`). If `plot-dispatch.sh --restart` refuses a draft PR by that function independently of the bundle, report it rather than patching the shell here; the plan names `plot-restart-command.mjs` as the route. Other branches in flight on `restart-command.ts` or `dispatch-verbs.ts`: none known at dispatch; check `git log origin/main -5 -- <file>` and the open PRs before you start.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
