## Implementation brief — an-approved-slice-has-a-name (slice 1: Approval refuses an unnamed slice)

- **Plan (canonical):** `docs/plans/2026-10-01-an-approved-slice-has-a-name.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/approval-refuses-an-unnamed-slice` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`. Do not run `gh pr create`.
- **Review of the code:** PR review, as for any slice in this repository.

Slice 2, `bug/the-queue-holds-an-unnamed-slice`, waits for this branch. It reuses the predicate this branch adds, so the predicate's name and signature are the contract between the two.

### What to build

A plan can reach `Approved` while it names a branch under no `###` heading. The agent then meets `slice-unnamed` in `openSlicePr` (`packages/domain/src/rules/slice-pr.ts:203`), writes the heading on its own branch, and the board shows `(unnamed)` until that PR merges (#1057). This slice refuses the approval instead.

Add one rule in `packages/domain/src/rules/` that answers *which branches does this plan name under no heading*. Input: the parsed `waves[]` from `plot-plan-meta.sh` (`waves[].name`, `waves[].branches[]`). Output: the branch names, in plan order. A branch counts when its wave has an empty name. A deferred branch counts too, because a deferred branch can return to the queue. Then make the approval ask it.

### The decisions the plan settles — do not re-derive them

**The approval that `plot-approve.sh` runs is NOT the one the plan cites.** The plan names `workflows/approve.ts:104` and its `ApproveRefusal`. Read on `origin/main` (`5a98f00a`), `plot-approve.sh` reaches a different function: `decide_transition` (`plot-approve.sh:510`) pipes eleven tab-separated fields to `board/plot-transition.mjs`, which runs `approve` from `packages/domain/src/transitions/plan.ts:226` (exported from the package as `approveTransition`). `workflows/approve.ts` is exported and tested (`test/workflows-approve.test.ts`) and no shell path calls it. A refusal added only there passes its test and never fires for an operator. That is the shape this repository keeps measuring: `setSprintState` had nine refusals and zero callers. So:

- Put the predicate in `rules/` and ask it from **both** `approve` functions. The plan's Done-when names the domain test for `approve`, which is the `workflows` one; keep that test, and add the same assertions against `transitions/plan.ts`.
- In `transitions/plan.ts` the natural carrier already exists: `ApproveInput.preconditions` and the `precondition-unmet` refusal (`:97`, `:173`, `:272`). Use it or add a dedicated `slice-unnamed` refusal beside it. Either way the refusal text names each branch and the repair: `add '### <name> (Branch: <branch>)' above it under '## Slices'`. A bare `precondition-unmet` with no branch name does not meet the plan.
- The refusal must fire **before the merge**. `decide_transition` runs at `plot-approve.sh:696`, after step 2 merged the plan PR. A refusal that fires there leaves the PR merged, the plan still Draft, and a refusal the operator can only clear by editing a merged plan. Refusals 1 to 3 sit before the merge (`:171`, `:193`, `:262`); the new one belongs beside them, reading the same `$meta` (`:156`), and it must write nothing. If you reach it through `plot-transition.mjs`, call the bundle once early and keep the later call, so the idempotent re-run still works.
- Wire change: `requestFrom` (`packages/board/src/server/entry/transition.ts:82`) refuses any line that is not exactly eleven fields and does not pad, on purpose: a padded empty record field reads as *no record yet* and the transition overwrites a dated approval. A twelfth field therefore needs every sender updated in one commit. Senders found: `plot-approve.sh`, `plot-deliver.sh`, and the transition tests. Search for `plot-transition.mjs` and for `requestFrom` before you start. A second bundle, or a separate argument to the existing one, is also acceptable if it keeps that rule intact.

**The shape is historical on this estate, so the refusal refuses nothing today.** `plot-plan-meta.sh` over all plans on `origin/main` finds 5 waves with branches and no name, none in a Draft or Approved plan. That is the expected result of the last Done-when line, not a sign the rule is wrong. Do not weaken the rule to make it fire.

**Rejected: reading the plan from a feature branch, naming a row from a PR title or branch name, changing `/plot-implement`, and changing the PR link.** The board reads the main ref on purpose. `slice-pr.ts:107` refuses a branch name as a title for the same reason. The link already resolves by head (`fleet.ts:6507`, `held ?? pr`) and is out of scope.

**Rules carried over unchanged.** The refusal applies to every review channel: `an-in-session-approval-has-a-controller` (#1088) will route `Review: in-session` through a controller, and that controller asks the same predicate. Absent is not false: a plan that cannot be parsed refuses as before, and the new rule never reads an empty `waves[]` as *all named*. Read the exit code, not the emptiness. A plan with no `## Slices` section names no branch, so the rule answers an empty list and approves, as it does today.

### Done when

The plan's `## Done when` list is the specification. The assertions a naive implementation passes without:

- **Reach test.** One test runs `plot-approve.sh --dry-run` (or the `plot-transition.mjs` bundle) on a plan with an unnamed branch and expects the refusal naming the branch. It catches the dead-rule failure above, where the domain test is green and the script approves.
- **Order test.** On the `pr` flow the refusal fires with the PR still unmerged and `git status` clean. It catches a refusal placed after the merge.
- **A deferred unnamed branch refuses.** A filter on `!deferred`, copied from `queueOfPlan`, would let it through.
- **A fully named plan approves exactly as before**, including the already-Approved idempotent re-run.
- **The estate run.** Run the predicate over every plan on `origin/main` and record in the PR: the count of historical unnamed waves (the plan measured 5) and that no Draft or Approved plan holds one.

Plus the repository gates: `pnpm --filter @plot-pm/domain typecheck` and `pnpm run typecheck` (the root script covers the board only), the domain tests (`pnpm --filter @plot-pm/domain test`), `pnpm run test:contracts` for the shell side, and `pnpm build:board` so the committed `board-server.mjs` and the `plot-transition.mjs` bundle match their sources (CI's no-diff gate). Run on Node 24 (`nvm use`). Do not run `test:e2e` locally; CI owns it. A new function in domain code is an arrow function. Write TSDoc that states what the export does, not why the decision was made. Add a changeset: the domain and board code takes `'@plot-pm/board': patch`, the shell script takes `plot: patch` with a `bumps:` block, and the description comes first.

### Bookkeeping

Open the PR with `plot-open-pr.sh`, then append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new predicate), `packages/domain/src/workflows/approve.ts`, `packages/domain/src/transitions/plan.ts`, `packages/board/src/server/entry/transition.ts`, `skills/plot/scripts/plot-approve.sh`, the rebuilt bundles, and their tests. It does not touch `rules/queue.ts` or `packages/board/src/server/queue-reading.ts`: `bug/the-queue-holds-an-unnamed-slice` owns them and starts after this one merges. At dispatch no other branch holds these files by the plan estate's record; verify with the dispatcher's overlap report rather than trusting this line.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
