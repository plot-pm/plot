# plot-approve reads the plan from one open PR and merges another

> `plot-approve` and `plot-needs-design` read a plan's gating record from the first open PR that changes the plan file, then act on the `idea/<slug>` PR; where the two differ, the approval judges one copy and merges the other.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3093
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3097 merged
- **Started:** 2026-11-03, Jan Wloka, `bug/plot-approve-reads-the-plan-from`
- **Delivered:** 2026-11-05
- **Released:** 2026-11-07, v2.31.0

## Changelog

- `/plot-approve` and `/plot-needs-design` read the plan record at the head of the PR they merge or write to. The approval pins its merge and its review status to that same head.
- When another open PR holds a different copy of the plan file, both commands refuse with `pr-copies-differ` and write nothing. An open PR with an identical copy does not stop them.
- When the checkout holds a copy of the plan that differs from the plan PR's head, both commands refuse with `checkout-copy-differs` and write nothing.

<!-- Board impact: none to the plan format or layout. The approve and needs-design controllers change behaviour; their bundles are rebuilt by main after the merge. -->

## Motivation

Issue #3093. Two open PRs can change one plan file, one of them on `idea/<slug>`. Then the gating record and the merged PR come from different PRs. Read on `origin/main` at `4e73b4372`.

- `remotePlanOf` in `packages/board/src/server/entry/approve.ts` reads the plan record at the head of the first open PR that `planPrsCarrying` returns (`packages/domain/src/rules/plan-pr.ts`). That function keeps the host's listing order.
- `planPrOf` in `plan-pr.ts` asks for the `idea/<slug>` PR first. When the host holds one, it is the plan PR, with `rivals: []`, and the rule never lists the open PRs.
- `perform` in `approve.ts` takes the PR to merge from that answer. The workflow judges the phase, `Review:` and the slices from the record that `remotePlanOf` read. The controller merges the `idea/<slug>` PR.
- The record and the merge pin come from two host answers. `remotePlanOf` reads at the `headSha` of the `pr-list` row. `choosePlanPr` asks `pr-state idea/<slug>`, and `writeApprovalStatus` and `pr-merge --match-head` take that answer's `headSha`. A push between the two calls makes the approval judge one commit and pin another.
- A plan in the checkout is judged from the working tree, and the approval merges the PR's head. The same split exists under `Impl: same branch`, where `sameBranchOf` names the PR.
- `packages/board/src/server/entry/needs-design.ts` holds its own `planPrOf`, not the domain rule. It takes `idea/<slug>` only when OPEN, then the first carrying open PR, then a CLOSED or MERGED `idea/<slug>`. It reads the record from the first carrying PR, and `bookOnPlanPr` writes onto `origin/<head>` as fetched again at write time. It finds a plan on the default branch with `file.endsWith(`${slug}.md`)`, the suffix match that `namesPlan` rejects.
- The `pr-ambiguous` refusal in `packages/domain/src/workflows/approve.ts` (in `approve` and in `approveSpike`) covers only the open route, where `rivals` is filled.

With two open PRs whose copies differ in `Review:` or in the slices, the approval judges the copy on PR B and merges PR A. GitHub reaches this path today. Bitbucket reaches it once `bug/plot-approve-finds-no-plan-on` (#3089) lets plain `pr-list` rows carry `headSha`.

## Design

### Approach

The record that gates an approval or a Design move comes from the head of the PR that the command merges or writes to. One sha is the read target, the review-status target and the `--match-head` pin, and it comes from one host answer.

1. **The domain rule names the read.** `planPrOf` names the PR to act on, the plan file and the head sha to read. The controllers read the plan only at that answer.
2. **The named PR's head comes from `pr-state`.** For an OPEN `idea/<slug>` PR, the `pr-state` answer gives the number, the state, the draft flag and the head sha. A shared head-read function fetches `idea/<slug>` when git does not hold that sha, resolves it to the full sha, and reads the paths the head changes. A head git does not hold after the fetch refuses `pr-head-unheld`. A `pr-list` row for the same PR number is not used for the head.
3. **Rivals are compared by blob ID.** On the named route, where the default branch does not hold the plan file, the rule also lists the open PRs and names every other PR that changes the plan file. The controller reads the plan file's git blob ID at each head (`refs.resolve('<sha>:<file>')`, an existing port operation). A rival whose blob ID equals the named PR's blob ID proceeds. A rival whose blob ID differs, whose path differs, or whose blob ID git cannot read, refuses `pr-copies-differ`.
4. **A named PR must carry the plan.** An OPEN `idea/<slug>` PR whose head does not change the plan file refuses `pr-carries-no-plan`.
5. **The checkout copy must match.** Where the checkout holds the plan and the command acts on an OPEN PR, the record is read at the pinned head. When the checkout's text differs from the text at that head, the command refuses `checkout-copy-differs` and writes nothing. Equal bytes mean equal blob IDs, so the domain compares the two texts.
6. **Refusals come before every host write.** The workflow decides each new refusal, so the controller throws before `pr-ready`, the approval status, the merge and the dry-run summary.

### The plan-PR answer

`packages/domain/src/rules/plan-pr.ts` changes as follows.

- `PlanPrReadings` gains `namedHead?: { sha: string; changed: readonly string[] } | null`: the full head sha of the OPEN named PR and the paths it changes against its merge base, or `null` where git does not hold the head after the fetch.
- `PlanPrAsk` gains the ask `'named-head'`.
- `PlanPrAnswer` gains `{ outcome: 'refused'; reason: 'pr-head-unheld' | 'pr-carries-no-plan'; number: number }`.
- `PlanPrFound` gains `route: 'named' | 'open' | 'merged'` and `read: { at: 'head'; sha: string; file: string } | { at: 'default' }`. `{ at: 'default' }` means the copy in the checkout, or else the copy on `origin/<main>`.
- `PlanPrFound.rivals` becomes `readonly { number: number; sha: string; file: string }[]`.

The routes answer as follows.

| Route | Condition | Answer |
|---|---|---|
| named | OPEN | ask `named-head`; `null` refuses `pr-head-unheld`; no plan file in `changed` refuses `pr-carries-no-plan`; where the default branch does not hold the file, ask `open` and name every other carrying PR as a rival; `read` is `{ at: 'head' }` at the full sha; `headSha` is that sha; `carried` lists the other plan files in `changed` |
| named | MERGED | `read: { at: 'default' }`, no rivals, as today |
| named | CLOSED | `read: { at: 'default' }`, no rivals; the workflow refuses `pr-closed` |
| open | `idea/<slug>` has no PR, default branch lacks the file | the first carrying PR, `read` at its listed head; rivals as today |
| merged | default branch holds the file | as today, `read: { at: 'default' }` |

### Controllers

- **Shared code.** `choosePlanPr` (the ask loop) and the head-read function `readHeadOf` move into `packages/board/src/server/entry/open-prs.ts`, which `bug/plot-approve-finds-no-plan-on` creates for `openPrsOf` and `holdsCommit`. Each controller passes its own refusal sentence, as `openPrsOf` does there. Both are arrow functions with a factual TSDoc block.
- **A plan absent from the checkout.** The controller asks `choosePlanPr` first, then reads the plan at `read`. `remotePlanOf` is deleted. A host refusal on this path throws at once, because no record exists yet to judge first.
- **A plan in the checkout.** The controller reads the checkout copy to learn `Review:` and `Impl:`. Under `Review: in-session` no PR is read, as today. Otherwise the controller asks `choosePlanPr`, reads the record at `read`, and passes the checkout text and the head text to the workflow.
- **`Impl: same branch`.** `sameBranchOf` names the branch and `readPlanPr` asks `pr-state`. `readHeadOf` fetches and resolves that head. The record is read at that sha, with the same `pr-head-unheld`, `pr-carries-no-plan` and `checkout-copy-differs` refusals. No merge happens on this arm.
- **The pin.** `writeApprovalStatus` and `pr-merge --match-head` take `found.headSha`, which is the sha the record was read at. No second host read of the head happens between the record read and the merge.
- **The spike route.** `approveSpike` reads the same readings and applies the same refusals as `approve`, beside its own `pr-ambiguous` arm.
- **Messages.** `refusalText` in `approve.ts` gains one case for each new reason. Each case names the PRs and says that nothing was merged and the phase is unchanged. `pr-copies-differ` tells the operator to close the PR that should not carry the plan. `checkout-copy-differs` tells the operator to push or discard the local edits. `pr-head-unheld` tells the operator to fetch `idea/<slug>` and re-run.

### Workflow readings

`ApprovePrReading` in `packages/domain/src/workflows/approve.ts` gains `route`, `blob` (the plan file's blob ID at the read sha), `refused` (the rule's refusal, passed through) and `copies?: { checkout: string; head: string }`. `rivals` becomes `readonly { number: number; file: string; blob: string }[]`. `ApproveRefusal` gains `pr-copies-differ`, `pr-head-unheld`, `pr-carries-no-plan` and `checkout-copy-differs`.

- `refused` is returned first, before `plan-not-found`, because the record cannot be read in that case.
- A named PR that is CLOSED for a plan that neither the checkout nor the default branch holds refuses `pr-closed` before `plan-not-found`.
- `checkout-copy-differs` and `pr-copies-differ` sit with the PR refusals, after the phase and review-channel refusals.
- On the open route, any rival still refuses `pr-ambiguous`: no PR is named, so the choice of the PR to merge would follow the listing order. On the named route, only a differing rival refuses.

### Needs-design

- The board-local `planPrOf` in `needs-design.ts` is deleted. The controller calls `choosePlanPr` from `open-prs.ts`, which asks the domain `planPrOf`.
- The plan read on the default branch uses `namesPlan` in place of `endsWith(`${slug}.md`)`.
- `NeedsDesignPrReading` gains the same `route`, `blob`, `rivals`, `refused` and `copies` readings, and `NeedsDesignRefusal` gains `pr-copies-differ`, `pr-head-unheld`, `pr-carries-no-plan` and `checkout-copy-differs`. Needs-design applies `pr-copies-differ` on both the named and the open route; it has no `pr-ambiguous`, because its write is a commit and not a merge.
- `bookOnPlanPr` resolves `origin/<head>` after its fetch. When that sha is not the read sha, it refuses: "origin/<head> moved since the plan was read. Nothing was written; re-run." It writes onto the copy it judged or not at all.
- `needs-design.ts` exports `perform(ctx, args, write)` beside `run`, as `approve.ts` does, so a unit test can drive the controller.

**Behaviour change, intended.** Needs-design now chooses its PR by the domain rule. When `idea/<slug>` is CLOSED and another open PR changes the plan, needs-design today writes onto that other PR; after this change it refuses `plan-pr-absent`, naming the closed PR. When the default branch holds the plan and `idea/<slug>` has no PR, an open PR that changes the file is not the plan PR, so needs-design refuses `plan-pr-absent` rather than writing onto it. Both follow from one rule for both commands.

### Rival detection limits

The listing finds a rival only where `openPrsOf` can read it.

- `pr-list` returns at most 100 open PRs (`PRS_LISTED`). When the listing fills that limit, the `step:` line says so.
- A PR from a fork (`repo !== ''`) is skipped.
- A row with no head sha, a head git cannot resolve after the fetch, or a head whose changed paths git cannot read, is skipped. `bug/plot-approve-finds-no-plan-on` names these rows.

A rival the listing does not see passes as no rival. That cannot cause a wrong merge, because the merged copy is the copy judged. It can leave a differing copy open. A run that proceeds is not proof that no rival exists.

### Host calls

The named route asks `pr-list` once where the default branch does not hold the plan file. A plan absent from the checkout pays that call today through `remotePlanOf`. A plan in the checkout pays one more call than today.

### Tests

Each test fails on `main` for the reason given, unless it is marked as a guard.

**Board, `packages/board/test/unit/approve.test.ts`.** The fixture holds an EMPTY plan store (`planStoreFixture({ files: {} })`, as `ctxDefaultBranch`), unless the case is about the checkout. Its `planStore.readPlan` is wrapped so that it parses the text that `readPlanAt` wrote through `writeText`, so two PR copies give two records. `hostFixture.prList` lists the rival first. `refsFixture` serves `resolve` for `<sha>^{commit}` and `<sha>:<file>`, `changedFiles` per head sha, and `showFile` per `<sha>:<file>`.

- Two open PRs, A on `idea/<slug>` (draft) and B, whose copies differ in `Review:` → `pr-copies-differ`; the fixtures record no `pr-ready`, no `commitStatus` write and no `pr-merge`. On `main` the approval merges A after it judged B's copy.
- The same two PRs with identical copies → the approval merges A with `--match-head <A's sha>`, and the `step:` line names `PR #A` as the read source. On `main` the line names `PR #B`.
- One open PR on `idea/<slug>`; `pr-list` names head L and `pr-state` names head S, with different copies at L and S → the record is the copy at S, the status is written on S and the merge pins S. On `main` the record is read at L and the merge pins S.
- The checkout holds the plan, and A's head holds a different copy → `checkout-copy-differs`, no host write. The same case under `Impl: same branch` → `checkout-copy-differs`. On `main` both judge the checkout copy; the first merges A.
- A on `idea/<slug>` does not change the plan file, and B does → `pr-carries-no-plan`, no host write. On `main` the approval judges B and merges A.
- `pr-state` names a head that `refsFixture` cannot resolve after the fetch → `pr-head-unheld`. On `main` the approval reads B's copy and merges A pinned to the unheld sha.
- Guard: `idea/<slug>` CLOSED and B open with the plan → `pr-closed`, no host write. This passes on `main` and keeps passing after the reorder.

**Board, needs-design.** A new `packages/board/test/unit/needs-design.test.ts` drives `perform`: two open PRs with differing copies → `pr-copies-differ` and no push; `idea/<slug>` CLOSED with B open → `plan-pr-absent` and no push (on `main` it pushes onto B); `origin/<head>` moved between the read and the booking fetch → refusal and no push. On `main` `perform` does not exist, and `run` writes onto B. `packages/board/test/unit/needs-design-route.test.ts` gains the two-PR case through the route.

**Domain.** `packages/domain/vitest.config.ts` holds `src/!(adapters)/**` at 100% lines, branches, functions and statements, so each new branch has a test.

- `packages/domain/test/rules-plan-pr.test.ts`: a named OPEN PR asks `named-head`; `null` refuses `pr-head-unheld`; a head that does not change the file refuses `pr-carries-no-plan`; with the default branch lacking the file the rule asks `open` and names rivals without the named PR's own number; with the default branch holding the file it asks no listing; `found` names `route`, `read` and the full sha; MERGED and CLOSED answer `read: { at: 'default' }`. On `main` the named route answers `rivals: []` and names no read.
- `packages/domain/test/workflows-approve.test.ts`: on the named route, a rival with a differing blob, a differing path or an empty blob refuses `pr-copies-differ`, and an equal blob decides; on the open route any rival refuses `pr-ambiguous` (the existing cases take the new rival shape); `refused` passes through ahead of `plan-not-found`; differing `copies` refuse `checkout-copy-differs`; CLOSED with no file refuses `pr-closed`.
- `packages/domain/test/approve-spike.test.ts`: the same named-route and checkout cases for `approveSpike`.
- `packages/domain/test/workflows-needs-design.test.ts`: each new needs-design refusal.

### Docs

- `skills/plot-approve/SKILL.md`, step 3, the paragraph that starts "**The plan PR is the PR that adds or changes the plan file.**": the last sentence states that on the `idea/<slug>` route an open PR with a differing copy refuses `pr-copies-differ`, and that on the open route any second PR refuses `pr-ambiguous`. The next paragraph, "**A plan the checkout does not hold is read from where it is.**", states that the plan is read at the head of the plan PR, and that a checkout copy that differs from that head refuses.
- `skills/plot-approve/SKILL.md`, step 3, the refusal sentence "refuses a plan that is not Draft, … and a plan that two open PRs both change" names the differing copy.
- `skills/plot-approve/SKILL.md`, step 3c, the refusal list: the `pr-closed`, `pr-absent` or `pr-ambiguous` item gains `pr-copies-differ`, `pr-head-unheld`, `pr-carries-no-plan` and `checkout-copy-differs`.
- `skills/plot/scripts/README.md`, the `plot-approve.sh` row: "A plan absent from the checkout is read from `origin/<main>` or from that PR's head" names the plan PR's head, and the "two open PRs changing the file refuse" clause names the blob rule.
- `skills/plot/scripts/README.md`, the `board/plot-needs-design.mjs` row: the move is judged and written at the plan PR's head, and a differing copy refuses.

## Slices

### Single-source plan read

- `bug/plot-approve-reads-the-plan-from` <!-- waits: bug/plot-approve-finds-no-plan-on --> — `planPrOf` names the PR, the plan file and the head to read; both controllers read only there and pin to that sha; rivals with a differing blob, a named PR without the plan, an unheld head and a differing checkout copy refuse by name; needs-design calls the domain rule; the tests and docs above. → #3112

Files: `packages/domain/src/rules/plan-pr.ts`, `packages/domain/src/workflows/approve.ts`, `packages/domain/src/workflows/needs-design.ts`, `packages/board/src/server/entry/open-prs.ts`, `packages/board/src/server/entry/approve.ts`, `packages/board/src/server/entry/needs-design.ts`, `skills/plot-approve/SKILL.md`, `skills/plot/scripts/README.md`, the tests above, and one changeset.

Changeset, description first and the comment block last:

```markdown
---
'plot': patch
'@plot-pm/board': patch
---

`/plot-approve` and `plot-needs-design` read the plan at the head of the PR they merge or write to, and pin the merge to that head. An open PR with a different copy of the plan file refuses `pr-copies-differ`, and a checkout copy that differs from the PR's head refuses `checkout-copy-differs`.

<!--
plan: docs/plans/2026-11-03-plot-approve-reads-the-plan-from.md
bumps:
  skills:
    plot: patch
    plot-approve: patch
-->
```

## Notes

- Found by the safety juror of the panel on `2026-11-03-plot-approve-finds-no-plan-on` (#3089, plan PR #3091).
- Amended after a four-juror panel (layering, safety, seams, testability; `unanimous amend`): `.plot/panels/2026-11-03-plot-approve-reads-the-plan-from/panel.md`.
- The slice waits on `bug/plot-approve-finds-no-plan-on`, which creates `open-prs.ts`, stores full shas in `OpenPr.headSha` and changes `plan-pr.ts`. Functions are cited by name because that slice moves their lines.
- `docs/sprints/2026-W45-follow-ups-2-30-1.md` holds no line for this slug on `origin/main` at `4e73b4372`.
- Related: [2026-11-03-plot-approve-finds-no-plan-on](2026-11-03-plot-approve-finds-no-plan-on.md), [2026-10-23-plot-approve-reports-no-pr-found](2026-10-23-plot-approve-reports-no-pr-found.md).
- PLOT-UNASKED: Does this plan carry significant design decisions? — default — proceeded; State: Draft
