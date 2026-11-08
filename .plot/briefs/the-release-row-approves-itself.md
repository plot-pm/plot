## Implementation brief — passkey-registration-moves-to-a-settings (wave 2: Release approval)

- **Plan (canonical):** docs/plans/2026-11-07-passkey-registration-moves-to-a-settings.md on main
- **Approved:** 2026-11-07, Jan Wloka, plan-PR #3215 merged
- **Branch:** `feature/the-release-row-approves-itself` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

This is the last slice of the plan. Both Foundations slices have merged: the attestation-object decoder (#3227) and the settings view (#3229). Nothing waits on this branch.

### What to build

Release approval lives in `PasskeyPanel` in the agent sidebar (`packages/board/src/app/components/AgentList.tsx:1035`). The operator types a release PR number and a head SHA into two inputs that the board already knows, and a typed SHA that disagrees with the shown head is refused by the server as `head-moved`. On 2026-11-06 the operator could not find the panel at all. Move the action onto the release PR's own row.

1. **A domain rule `releaseApprovable`** in `packages/domain/src/rules/` (arrow function, factual TSDoc). It answers one of `hidden`, `disabled` or `enabled`, plus the reason wording for `disabled`. Inputs: the release PR's reading (state, `headSha`, `checks`, `checksSha`, `plotReview`, `plotReviewSha`) and the passkey registration (`PasskeyRegistration | null`).
   - `enabled`: PR open, `plot/review` passed on the head, CI green on the head, a passkey registered.
   - `disabled` with "Register a passkey in Settings first": ready, but `registered` is false.
   - `hidden`: the PR is not ready, or not open.
   - `held === null` (unread or unreachable) is not "unregistered": it answers `disabled` with the pending wording and no Settings pointer. `passkeySettings` in `rules/passkey-settings.ts` already holds this distinction; follow it.
2. **The row** (`rowSubject(...) === 'release'`, `lib/agent-rows/rows.tsx:123`, and the release arm of `tuple-row.ts:654`) renders "Approve release" from that answer. The `.tsx` renders the answer and decides nothing. The click asks `challenge({action:'release-approve', pr, sha})`, then `assertWith`, then `post('/api/release-approve', …)` as `PasskeyPanel.approve` does today (`lib/passkey-client.ts`). Use the row's own `pr.number` and `pr.headSha`; no input.
3. **Remove the sidebar panel**: `PasskeyPanel.tsx`, its import and mount in `AgentList.tsx`, and the free-form fields. Its tests go with it. Keep `refusalWording` and `originNotice` in `lib/passkey.ts`; the settings view and the row use them.

### Decisions the plan settles — do not re-derive them

**Readiness is a domain property, and the server is still the gate.** *Every rendered state is a domain property* (`CLAUDE.md`). A button's enabled state computed in `.tsx` is testable only by rendering it. The server re-reads the head and `plot/review` before it merges and refuses `head-moved`, `review-missing` and `checks-missing` (`workflows/release-approve.ts:138-148`). The row's reading is a convenience and never the gate; the rule must not claim to replace the server's check.

**Reuse the release readiness that exists; do not write a third copy.** `release-prepare.ts` already holds `reviewPassed` (`trustedReview(row) === 'success' && row.plotReviewSha === row.headSha`, line ~210) and `releaseStage` reaches `ready` only with `ciCounted(pr.ciChecks) && pr.checksSha === pr.headSha` (line ~234); `release-checks-counted.ts` holds `ciCounted`. `releaseApprove` uses the same two. `releaseApprovable` composes `trustedReview`, `plotReviewSha === headSha`, `ciCounted` and `checksSha === headSha`. A `success` review that no judgment covers is not a pass, and a review naming another commit is not a pass on this head; both rules are why `trustedReview` exists. Export what you need from where it lives rather than restating it. Do not use `releaseStage === 'ready'` as the row's answer: `releaseStage` also needs the scope's phases and the required workflow, and the board writes `releaseStage: ''` on every row today (`server/fleet.ts:6678`, `:7065`, `:7393`), so that field is empty here.

**The board's PR rows do not carry the review today — this is the one thing the plan did not anticipate.** `CardPr` (`contract/schema.ts`, `headSha`, `checks`, `checksSha`) has no `plotReview` or `plotReviewSha`; those live on the PR index row (`entities/pr-index.ts:110-117`). The plan says no board artifact contract moves. Two ways to get the review onto the row, and a person chooses if the first fails: (a) add `plotReview` and `plotReviewSha` as `.optional()` fields on `CardPr`, never `.default('')`, because absent means "the server predates the field", not "no review" (the rule `headSha` already obeys); (b) have the server compute the release row's readiness and ship the answer. Prefer (a): it keeps the rule in the domain and the server a reader of the index. If you need (b), or the schema change has wider reach than two optional fields, stop and report it with the number of call sites the change touches.

**The index never says no.** *A Decision Reads The Index* (`CLAUDE.md`): the index supplies a pass, and a missing field, a missing row or an old-version store means "ask the host", never "not ready". Here that gives: an absent `plotReview` or `plotReviewSha` answers `hidden` (not approvable on what the board knows), and never a stated failure. The button then shows nothing, and the server stays the only place that can refuse by name.

**The sidebar fields leave outright.** Keeping the free-form PR and SHA inputs "for the case where the row has none" re-opens the typed-SHA defect the slice removes. A release PR with no row has no approval button, and the operator sees it on the next scan.

**Rules carried over unchanged.** Absent is not false. The browser decides nothing the server re-decides. Every function you write is an arrow, in the board too (`CLAUDE.md`, *Arrow functions*). The settings view (`SettingsView.tsx`) and `passkeySettings` own registration wording; do not restate "No passkey registered" here, and import the pointer text from the domain.

### Done when

The plan's `## Changelog` line "The release PR's row shows 'Approve release' while the release PR is ready; the PR number and head SHA come from the board's own reading and the sidebar fields leave" is the specification (the plan carries no `## Done when` list). Lift these assertions, each of which a naive implementation passes without:

- **A table over every input of `releaseApprovable`** in `packages/domain/test/`: review `success` on the head, `success` on another sha, `pending`, `failure`, absent; CI `green` on the head, `green` on another `checksSha`, `pending`, `failing`, `unknown`, absent; PR open and not open; registered, unregistered and `null`. Each row asserts the answer and the wording. The same-sha rows catch a rule that tests only the colour.
- **A review `success` on a stale head hides the button.** Catches a rule that reads `plotReview` without `plotReviewSha`.
- **`null` registration is not "register first".** Asserts the pending wording and that it names no Settings pointer. Catches `held?.registered` read as false.
- **The row passes the row's own `pr` and `sha`.** One component or tuple-row test asserts the challenge subject and the POST body carry `pr.number` and `pr.headSha` of the clicked row. Catches an implementation that kept a stale input state.
- **The sidebar no longer mounts the panel.** A test asserts `data-testid="passkey-panel"` is absent from the Agents tab; delete or move `PasskeyPanel`'s own tests rather than leaving them green over dead code.
- **A browser test proves the button shows** on a fixture release row that is ready, and does not show on one with a stale review sha. Per the layering rule this is where it is *seen*, not where it is decided; add one test and no more, and note that `pnpm run test:board` is CI's and takes the operator's board down when run locally.

Plus: add a changeset for `@plot-pm/board` (`patch`, description first and the `bumps:` block last, with the `plan:` line), and run `./scripts/check-changeset-packages.sh`. Do not commit a rebuilt board artifact (`scripts/check-no-bundle-diff.sh`); rebuild it only to test locally and restore the generated paths before you push. If you add a `CardPr` field, run `scripts/check-card-presentation.sh`. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs`, with the path resolved from the repo root, before each push, and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not bind it.

### Bookkeeping

When the PR opens, run `skills/plot/scripts/plot-open-pr.sh` and not `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/release-approvable.ts` (new) with its test, the release arm of `packages/board/src/app/lib/tuple-row.ts` and `lib/agent-rows/rows.tsx`, the row's component, and the removal of `PasskeyPanel.tsx` and its mount in `AgentList.tsx`. A `CardPr` addition in `contract/schema.ts` is in scope only as the two optional fields described above.

Do not touch `server/passkey.ts`, the `/api/passkey/*` and `/api/release-approve` routes, `workflows/release-approve.ts` or `SettingsView.tsx`. Both Foundations branches have merged and no other branch of this plan is in flight. Another plan's work may touch `AgentList.tsx` and `tuple-row.ts` (both are shared files); keep edits to the lines named above and rebase rather than reformat.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
