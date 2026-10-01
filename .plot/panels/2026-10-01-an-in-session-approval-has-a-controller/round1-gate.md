# Juror: the gate's security (round 1)

Read only. I ran `git fetch`, `git show origin/main:<path>` and `gh api` reads. I wrote only this file.

Position: amend

## 1. Fit to #1088

The plan fixes the approval the issue asks for. `Released` is outside the issue's scope and widens the change.

## 2. Claims on origin/main

- `plot-approve.sh:200-205` — `in-session)` / `die "... the reviewer is a human in the room."` True.
- `transitions/plan.ts:257-262` — `case 'in-session': case 'ballot': return refuse(... 'review-human' ...)`. True.
- `workflows/approve.ts:65-70` — `ApproveInput { on; who }` has **no `channel`**. `:208-210` derives the channel from the plan PR, and `:169` switches on `readings.pr.state`. The plan does not say how an in-session plan with no PR passes either.
- `release.ts:270` true. `:277` records `normalizeVersion(plan.tag)`, the plan's own tag, not a caller's version.
- `entry/transition.ts` sits at `packages/board/src/server/entry/`. It already carries `who` and `channel` (`:90`).
- `plot-approve.sh:3,115,293` **already takes `--who`**, defaulting to `git config user.name`. The plan adds `--reviewer` beside it and gives no precedence.

## 3. Tests

All four named tests fail today. No test covers A–C below.

## 4. Security findings

**A. Self-approval by naming a reviewer.** `/api/approve` is gated only by loopback (`index.ts:218-224`). An agent can `curl` it with `"reviewer":"jwloka"`. The controller then leaves its action receipt, and the script leaves its owner receipt. Both gates clear, and nothing records the bypass. Today the same act needs `--unowned` with a required reason, which is counted.

**B. The count disappears.** Done-when says "adds no row to `unowned-state-writes.tsv`" and names no replacement record.

**C. Unattended arm.** With `Approve command` set, `approve.ts:294-297` spawns `claude -p /plot-approve`. That agent could approve an in-session plan with no human present.

**D. `--release` trusts a string.** `git tag --list` proves that the tag exists, not that it contains the plan's work.

Editor forgery of a receipt is unchanged and still impossible. The new risk is a forged name, not a forged receipt.

## Required changes

1. Append every in-session approval to a counted log under `.plot/state/` (date, slug, reviewer, entry: board or script). Done-when asserts one row there.
2. Refuse `--reviewer` under `PLOT_UNATTENDED=1` and in the `Approve command` arm, with a contract test.
3. Refuse a reviewer not declared in `People`, and an empty or whitespace reviewer, in the script.
4. Fold `--reviewer` into `--who`, or state their precedence. `git user.name` never defaults an in-session reviewer.
5. Specify the workflow's in-session path: a `channel` input and a skip of the PR switch at `:169`.
6. `--release`: require `git tag --contains` the merge commit, or use the domain's `plan.tag`.
7. Correct the `entry/transition.ts` path.
