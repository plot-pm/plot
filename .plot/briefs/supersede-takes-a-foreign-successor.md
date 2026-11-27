## Implementation brief — supersede-names-a-plan-in-another-repository (wave 1: Command)

- **Plan (canonical):** docs/plans/2026-11-27-supersede-names-a-plan-in-another-repository.md on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `feature/supersede-takes-a-foreign-successor` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

The slice `feature/the-supersede-dialog-takes-a-foreign-successor` (Board) waits on this one. It reuses `successorReference` and the `successor-unparsed` reason, so name both as exports it can import.

### What to build

On 2026-11-24, `plot-supersede.mjs --by plot-init-checks-for-the-bb-cli plot-init-checks-bb` in the agent-skills-internal checkout refused `successor-not-found` and wrote nothing, because the successor lives in plot-pm/plot. The workaround was a hand edit (`fd401290a`). This slice lets `--by owner/repo:slug` record a successor in another repository, unverified.

Three pieces, all in the existing supersede path:

- **`successorReference(by)`** — a new arrow-function rule in `packages/domain/src/rules/supersede-successor.ts` (or a sibling rule file). It answers `{ repo: '', slug }` for a bare slug, `{ repo: 'owner/repo', slug }` for `owner/repo:slug`, and `unparsed` for anything else. The `owner/repo` grammar is the one in `rules/cross-repo-reference.ts` (`[A-Za-z0-9._-]+/[A-Za-z0-9._-]+`). The slug part follows the board's `SLUG_RE` (`packages/board/src/server/supersede.ts`).
- **`successorPreconditions` takes the parsed reference.** For a foreign reference: add `successor-unparsed` where parsing failed, never apply `same-plan`, and skip `successor-not-found`. For a local one nothing changes. Extend `SuccessorRefusal` and `supersessionRefusalReason` with `successor-unparsed`, or the refusal collapses to `precondition-unmet`.
- **The `(unverified)` record.** `supersede` (`packages/domain/src/transitions/plan.ts:1162`) forms the record as `${on}, by \`${by}\`` at line 1184. A foreign successor writes `${on}, by \`owner/repo:slug\` (unverified)`. The local record stays byte-identical. The command's summary line names the successor as unverified.

The controller has two call sites that each build `successorPreconditions` from a file lookup: `packages/board/src/server/entry/supersede.ts` and `packages/board/src/server/entry/supersession.ts` (lines 229 and 341 at dispatch). Both must parse `by` first, and a foreign reference must skip `findPlanFile` and `planFileOnMain` entirely. The bundle `skills/plot/scripts/board/plot-supersede.mjs` is generated; do not commit a rebuild.

### Settled decisions — do not re-derive them

**The command does not verify the foreign plan.** `[question-verify-foreign]` recommends no. Verification needs a new `Host` file-read operation. Through a connector it costs a host call per supersession and fails on a repository the account cannot read. The record carries `(unverified)` as its own statement of what was not checked. Do not add a `Host` operation and do not call `gh api` or `plot-host.sh` from this slice.

**One host only.** `[question-host-reference]` puts a successor on another host out of scope. `owner/repo` names a repository on the same host, as `→ owner/repo#N` does. Do not add a host prefix to the grammar.

**A reference naming this repository's own `owner/repo` is read as a bare slug.** `--by plot-pm/plot:<local slug>` in plot-pm/plot reads the local file and refuses `successor-not-found` where none exists. Without this, the same plan has two spellings and one of them skips the check that protects against a typo. The controller needs this repository's `owner/repo` for the comparison. Read it through the existing host/refs path the controller already holds, never a new `gh` call. Where it cannot be read, treat the reference as foreign and say so in the summary.

**`same-plan` never applies to a foreign reference.** A plan in another repository may carry the same slug; that is the case in the motivating incident's mirror image.

**`successor-unparsed` is a refusal, never a guess.** `owner/:x`, `/repo:x`, `owner/repo:`, `a/b/c:x`, `owner/repo` with no `:slug`, and whitespace inside the reference all refuse. Nothing is written. A bare slug that was valid before stays valid.

**Rules carried over from related work.** A refusal names its reason and writes nothing. `PLOT_UNATTENDED=1` still refuses first (`unattended`), unchanged. An empty `by` still produces no reading and `supersede` refuses `successor-missing`. The idempotent case still holds: re-running against a plan already Superseded answers `already` with the record as written, and does not append `(unverified)` twice.

### Done when

The plan's `## Slices` test line is the specification, and the three assertions are:

- `--by quatico-solutions/agent-skills-internal:plot-init-checks-bb` writes `Superseded: <date>, by \`quatico-solutions/agent-skills-internal:plot-init-checks-bb\` (unverified)` with no plan file of that slug present. This catches an implementation that still looks the file up.
- `--by owner/:x` refuses `successor-unparsed` and leaves the plan file unchanged. This catches a parser that falls through to a bare-slug read, which would refuse `successor-not-found` or write a record for a malformed name.
- `--by plot-pm/plot:<local slug>` in plot-pm/plot reads the local file and refuses `successor-not-found` where none exists. This catches an implementation that treats every `owner/repo:` form as foreign and so records an unverifiable successor for this repository's own typo.

Add these, because a naive implementation passes without them:

- A local successor's record is byte-identical to today's. This catches a `(unverified)` suffix leaking onto the local arm.
- A foreign reference with the plan's own slug (`other/repo:<same slug>`) is accepted. This catches `same-plan` applying to the foreign arm.
- `supersessionRefusalReason` returns `successor-unparsed`, not `precondition-unmet`.
- Unit tests of `successorReference` and the new arm of `successorPreconditions` sit in `packages/domain/test/supersede-successor.test.ts` beside the existing ones, with no controller or process.

Plus: add a changeset (`'plot': minor`, description first, `bumps:` block last, `plan:` line pointing at the plan file). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count here; if a change does reach one, pay for growth in the same change by removing shell elsewhere. New functions are arrows. TSDoc states what an export does and how it fails, with no history.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/supersede-successor.ts`, `packages/domain/src/transitions/plan.ts` (the `supersede` record only), `packages/domain/test/supersede-successor.test.ts`, `packages/board/src/server/entry/supersede.ts`, `packages/board/src/server/entry/supersession.ts`, their tests, and the changeset.

`feature/the-supersede-dialog-takes-a-foreign-successor` owns `packages/board/src/server/supersede.ts` (the route and its `SLUG_RE` check), `packages/board/src/app/components/SupersedeButton.tsx`, `successorEntry`, and the plan card's successor text. Leave them. Where the route still rejects `owner/repo:slug` at the HTTP layer after this slice, that is expected and the next slice's work.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
