## Implementation brief — plot-approve-reads-the-plan-from

- **Plan (canonical):** docs/plans/2026-11-03-plot-approve-reads-the-plan-from.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3097 merged
- **Branch:** `bug/plot-approve-reads-the-plan-from` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the PR, per repo convention

This slice waits on `bug/plot-approve-finds-no-plan-on` (#3089). That slice creates `packages/board/src/server/entry/open-prs.ts` (`openPrsOf`, `holdsCommit`), stores full shas in `OpenPr.headSha` and changes `plan-pr.ts`. At brief time `open-prs.ts` is absent from `origin/main` and the sibling has no PR. Start only when that slice has merged, then rebase on `origin/main`.

### What to build

`/plot-approve` and `/plot-needs-design` read a plan's gating record from the first open PR that changes the plan file, then act on the `idea/<slug>` PR. With two open PRs whose copies differ in `Review:` or in the slices, the approval judges one copy and merges the other (#3093). After this change one sha is the read target, the review-status target and the `--match-head` pin, and it comes from one `pr-state` answer.

Build, in this order:

1. `planPrOf` in `packages/domain/src/rules/plan-pr.ts` names the PR, the plan file and the head to read. Add `namedHead` to `PlanPrReadings`, the ask `'named-head'`, `route` and `read` on `PlanPrFound`, the new refusals `pr-head-unheld` and `pr-carries-no-plan`, and the rival shape `{ number, sha, file }`.
2. `ApprovePrReading` and `ApproveRefusal` in `workflows/approve.ts`, and the matching types in `workflows/needs-design.ts`, gain `route`, `blob`, `refused`, `copies` and the refusals `pr-copies-differ`, `pr-head-unheld`, `pr-carries-no-plan`, `checkout-copy-differs`.
3. Move `choosePlanPr` and a new `readHeadOf` into `open-prs.ts`. Delete `remotePlanOf` from `approve.ts`. Delete the board-local `planPrOf` from `needs-design.ts` and use `namesPlan` in place of `endsWith(`${slug}.md`)`.
4. `bookOnPlanPr` refuses when `origin/<head>` is not the read sha, and `needs-design.ts` exports `perform(ctx, args, write)` beside `run`.
5. Tests, docs and the changeset listed in the plan.

### Settled decisions — do not re-derive

- **The `pr-list` head is not used for the read.** `remotePlanOf` reads at the `pr-list` row's `headSha`, while the status write and `--match-head` take the `pr-state` sha. A push between the two calls splits them, and on Bitbucket the `pr-state` sha is a 12-hex short hash. One `pr-state` answer, resolved to a full sha by `readHeadOf`, serves all three uses.
- **Rivals compare by blob ID, not by listing order and not by "any rival refuses".** Seams argued to allow every rival; safety and layering argued to refuse every rival. The panel settled on `refs.resolve('<sha>:<file>')`: an equal blob proceeds, a differing blob, differing path or unreadable blob refuses `pr-copies-differ`. On the open route, where no PR is named, any rival still refuses `pr-ambiguous`.
- **A checkout copy that differs from the PR head refuses `checkout-copy-differs`.** This also covers `Impl: same branch` and `approveSpike`. Do not scope it out.
- **needs-design changes behaviour on purpose.** With `idea/<slug>` CLOSED and another open PR carrying the plan, it now refuses `plan-pr-absent` instead of writing onto the other PR.
- **Refusals come before every host write** (`pr-ready`, approval status, merge, dry-run summary). `refused` returns before `plan-not-found`; a CLOSED named PR for an absent plan refuses `pr-closed` before `plan-not-found`.
- **Rival detection has limits and the plan states them:** `PRS_LISTED` = 100, fork PRs skipped, rows with unresolvable heads skipped. Say so in the `step:` line when the listing fills the limit. A run that proceeds is not proof that no rival exists.
- **Carried rules:** absent is not false; a missing head is `pr-head-unheld`, never `plan-unparseable`. Functions you write are arrows with factual TSDoc, no decision history in comments.

### Done when

The plan's `## Design` tests section is the specification. Assertions that exist because a naive implementation passes without them:

- Two open PRs with differing copies record no `pr-ready`, no `commitStatus` write and no `pr-merge` (catches a refusal placed after a host write).
- `pr-list` head L and `pr-state` head S with different copies: the record is S's copy and the merge pins S (catches reading at the listed head).
- The board approve fixture uses an EMPTY plan store with `readPlan` wrapped to parse `writeText` output (catches a test that judges the checkout copy and never reaches the remote read).
- The `CLOSED idea/<slug>` guard case passes on `main` and after the reorder.
- Domain code under `src/!(adapters)/**` holds 100% lines, branches, functions and statements, so every new branch needs a test.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Add the changeset exactly as the plan gives it (description first, `bumps:` block last). `scripts/check-shell-lines.sh` refuses shell growth; this slice should touch no `.sh` file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Files this branch owns: `packages/domain/src/rules/plan-pr.ts`, `packages/domain/src/workflows/approve.ts`, `packages/domain/src/workflows/needs-design.ts`, `packages/board/src/server/entry/open-prs.ts`, `.../approve.ts`, `.../needs-design.ts`, `skills/plot-approve/SKILL.md`, `skills/plot/scripts/README.md`, the tests the plan names, and one changeset.

In flight: `bug/plot-approve-finds-no-plan-on` owns `open-prs.ts` creation, `OpenPr.headSha` and edits to `plan-pr.ts` — wait for its merge. Cite functions by name, not line, because that slice moves lines.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
