## Implementation brief — plot-approve-finds-a-plan-pr-at-any-age (wave 3: Slice branch)

- **Plan (canonical):** docs/plans/2026-11-21-plot-approve-finds-a-plan-pr-at-any-age.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3617 merged
- **Branch:** `bug/plot-approve-refuses-a-slice-on-the-plan-branch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch is the last wave. It waited on `bug/plot-approve-asks-the-pr-of-the-adding-merge` (wave 2), which merged as #3653 and now sets `readings.pr.branch` from the merged route's answer; wave 1 merged as #3625. Nothing waits on this branch.

### What to build

A plan whose slice names the plan PR's own head branch reads as complete the moment the plan PR merges, so the pulse never opens that slice and delivery counts it as landed. Measured 2026-11-21 on `templates-show-named-identifiers`: its slice moved to `docs/templates-name-their-identifiers` for that reason (`docs/plans/2026-11-16-templates-show-named-identifiers.md:81` on `origin/main` `c26164274`). Before wave 2 the merged route returned `branch: ''`, so nothing could compare the two. Wave 2 names the branch, and this slice compares it.

1. **`slice-on-plan-branch` in `approve` (`packages/domain/src/workflows/approve.ts`).** Add the reason to the refusal union. Refuse where `impl` is not `same-branch`, the plan PR is found (`MERGED` or `OPEN`), `readings.pr.branch` is not empty, and a branch in `readings.branches` equals it. The detail names the branch and the PR. Position: after `pr-closed`, `pr-merge-unnamed` and `pr-absent` (the `switch (readings.pr.state)` at about `:364`), because it needs a found PR, and before `checkout-copy-differs`, `pr-copies-differ` and `pr-ambiguous`, so it fires before any write, including the `pr-merge` write of the open route. Re-read the file before editing; line numbers have moved.
2. **The in-session read.** The workflow skips the PR switch for `Review: in-session` (`if (!inSession)`), and the entry skips the PR read for an in-session plan in the checkout (`plan === undefined || !inSession`, `packages/board/src/server/entry/approve.ts` at about `:940`). Under `Plan PRs: required` an in-session plan on the default branch still reached main through a plan PR, and `templates-show-named-identifiers` was one. So where `Review: in-session` holds and the default branch holds the plan file, the entry reads the adding merge and asks `prsOfCommit` once, with no list fallback and no `confirm`, and sets `readings.pr.branch` and `readings.pr.number` (and a state of `MERGED`) from the row that matches the second parent and the merge commit. An `unaskable`, `failed` or unmatched answer leaves the branch empty. The check then does not fire and nothing is refused, because an in-session plan needs no PR. In the workflow, the in-session check sits after the in-session checks the workflow runs today and before any write.
3. **The entry text (`refusalText`, `approve.ts` at about `:500-530`).** For `slice-on-plan-branch`, print the plan's text:

   `slice <branch> is the plan PR's head branch (#N); its merge reads as this slice landing.`
   `  Rename the slice's branch in the plan, then re-run. Nothing was merged and the phase is unchanged.`

   Assert both lines, with the real branch and number, line by line.
4. **`skills/plot-approve/SKILL.md`**: one sentence naming the refusal, next to the `pr-merge-unnamed` entry at about `:410`, and one in the plan-PR paragraph at about `:275`.
5. **A changeset**, with the description first and the `bumps:` block last, `plot-approve: patch`. Run `./scripts/check-changeset-packages.sh`.

### Decisions the plan settles — do not re-derive them

- **The check lives in `approve`, not in `/plot-idea` and not in the pulse.** Approval is the last step before dispatch and the one step that reads the plan PR's branch. `/plot-idea` names `idea/<slug>` for a plan PR under `own branches` and cannot see a later merge from another branch. A pulse-side rule would act after dispatch.
- **`same-branch` is exempt.** Under `same branch` the plan PR is the implementation PR by design, so its head branch is the slice's branch. Without the exemption every same-branch plan refuses. Test: the same plan under `same branch` passes.
- **The refusal fires before every write.** On the open route the PR merge is irreversible, and merging first would land the plan PR whose branch the slice then reads as merged. A test must show a plan with a slice on the open PR's head refusing with no `pr-merge` write.
- **An in-session plan reads one commit answer and nothing else.** No list fallback, no `confirm`: a wrong or absent answer leaves the branch empty and the plan approves, because refusing an in-session plan on a failed optional read would turn a host outage into a refusal of a plan that needs no PR. Absent is not a verdict.
- **Match both facts, not the first row.** The row must match the second parent (`shaMatches`, `plan-pr.ts`) and the merge commit. A commit can carry more than one PR, and taking the first row names the wrong branch.
- **`pr-copies-differ` and `checkout-copy-differs` rank below this refusal.** A plan with both a slice on the plan branch and a differing checkout copy refuses `slice-on-plan-branch`. Test it.
- Wave 2's rules carry over unchanged: an empty answer is `unnamed`, never `none`; `failed` refuses as a host failure and `unaskable` falls back to the list; the index never says "no PR".

### Done when

The plan's `### Tests per slice` list for *Slice branch* is the specification:

- `packages/domain/test/workflows-approve.test.ts` — a slice on the merged plan PR's branch refuses `slice-on-plan-branch` with no writes (catches a check placed after the writes); the same plan under `same branch` passes (catches a missing exemption); a slice on another branch passes; an open-route plan PR whose head is a slice branch refuses before the `pr-merge` write; a plan with both a slice on the plan branch and a differing checkout copy refuses `slice-on-plan-branch` (catches a wrong position); an in-session plan on the default branch whose adding merge's PR names a slice branch refuses; an in-session plan whose commit answer is `unaskable` approves (catches an in-session read that refuses on an unread answer).
- `packages/board/test/unit/approve.test.ts` — the refusal text names the branch, the PR and the next action, asserted line by line; an in-session plan on the default branch asks `prsOfCommit` once and `prList` never (catches a list fallback).

Plus: the changeset above. Do not run `pnpm run test:e2e` locally. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows. This slice touches no `.sh` file; if it must, pay for the growth in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/workflows/approve.ts`, `packages/board/src/server/entry/approve.ts` (the in-session read and `refusalText`), `skills/plot-approve/SKILL.md`, a changeset, and the tests above. Waves 1 and 2 are merged: use `Host.prsOfCommit`, `planPrOf`, `choosePlanPr` and `approveHostOf` as they stand; do not edit `plan-pr.ts`, `open-prs.ts`, `adapters/host/*` or `needs-design.ts`. No other branch of this plan is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
