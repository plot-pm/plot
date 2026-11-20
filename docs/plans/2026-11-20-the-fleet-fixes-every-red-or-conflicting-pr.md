# The fleet fixes every red or conflicting PR that no person works on

> fleetd's fixer acts on every open, non-draft PR into the default branch or a `sprint/*` branch, except a release PR, a repair PR and a PR whose head a person pushed in the last hour, and it fixes a merge conflict as a third finding kind beside HIGH and CI red.

## Status

- **State:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3597 merged
- **Started:** 2026-11-20, Jan Wloka, `feature/the-fixer-scope-reads-every-open-pr`

## Changelog

- fleetd's fixer works on every open, non-draft pull request into the default branch or a `sprint/*` branch, not only on the active sprint's slices. It skips a release PR (`changeset-release/`), a PR that a fleetd repair or revert owns, and a PR whose head a person pushed less than one hour ago.
- The fixer resolves a merge conflict: on a PR that the host reports as conflicting, it merges the base branch into the PR's branch, resolves the conflict and pushes, at most once for one head and one base tip, and at most twice per PR.
- The merge arm's `conflicting` hold now fires: it compared the stored word against `CONFLICTING`, which the PR index never stores.
- The Delivery tab names what a fixer works on: "fixing CI ✗", "fixing review ✗" or "fixing conflict ✗", read from the fixer's own attempt record.

<!-- Board impact: slice 3 changes the Delivery tab's fixer row (packages/board, packages/domain). Slices 1 and 2 change fleetd and the domain only. No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

Operator requirement, 2026-11-20: *"Failing CI or a conflicting branch need to be fixed without a person."*

Today the fixer acts only on PRs that the active sprint names. `readFixerPass` reads the sprint scope (`packages/fleet/src/shared/auto-fixer.ts:677`), and `slicePrNext`'s `guardArm` answers `out-of-scope` for every head branch that the scope does not name (`packages/domain/src/rules/slice-pr-next.ts:185-186`). A PR that no plan names never gets a fixer: on 2026-11-20 that held #3594 (`bug/release-approval-blocks-only-when-approvable`, conflicting), the master agent's fix PRs #3591 and #3595, and Max's #3589 (`experiment/bitbucket-has-no-issues`) until it merged.

Scope is not the only gate. For a PR with no worktree on this machine, `fixerTick` reads the desk as `{ dead: false, why: 'elsewhere' }` (`auto-fixer.ts:374`), and `ciRedArm` answers `desk-alive` for it (`slice-pr-next.ts:315-316`). So a widened scope alone would still fix nothing on a PR that no agent ever owned.

No arm acts on a conflict. The fixer knows two finding kinds, `high` and `ci` (`packages/domain/src/entities/fixer-attempts.ts:22-23`). The merge arm holds a conflicting PR, but its test compares `row.mergeable === 'CONFLICTING'` (`slice-pr-next.ts:395,429`), while the index stores the lowercase word that `mergeableOf` returns (`packages/domain/src/rules/github-pr-row.ts:87`). The live store read on 2026-11-20 at 20:11 UTC (`v: 8`) holds six OPEN rows, one of them #3594 with `mergeable: "conflicting"`; the hold never fires on it. A desk agent repairs a conflict on its own branch (`mergeConflictCorrectionEnding`, `packages/domain/src/workflows/agent-loop.ts:541`), and nothing repairs one on a branch that has no desk.

## Design

### Approach

**Slice 1, the fixer's scope:**

- **One rule, a domain property.** `fixerScope(input)` in `packages/domain/src/rules/fixer-scope.ts` answers `{ in: true; owner: 'desk' | 'none' }` or `{ in: false; why }`. Its input is the PR's OPEN row, the default branch's name, the owner reading below, whether the fixer's attempts record proves that the fixer pushed the current head (`fixerPushedHead`, `packages/domain/src/rules/fixer-attempts.ts:59`), and `now`. The reasons, in this order:

  | Reason | When |
  |---|---|
  | `no-row`, `not-open`, `draft` | as `guardArm` today (`slice-pr-next.ts:180-182`) |
  | `release-pr` | the head branch starts with `changeset-release/` |
  | `repair-owned` | the head branch is `bug/main-repair-<12 hex>`, `bug/sprint-repair-<12 hex>` or `bug/revert-<n>`: the repair and revert roles own these branches |
  | `base-unread` | the row has no `base`, or the default branch's name is unread; the index never says no |
  | `base-out-of-scope` | the base is neither the default branch nor a `sprint/` branch |
  | `owner-unread` | the owner reading failed |
  | `head-age-unread` | the owner is `none`, the fixer did not push the head, and the row's `headSince` is absent or does not parse |
  | `person-pushed-recently` | the owner is `none`, the fixer did not push the head, and `headSince` is less than `PERSON_QUIET_MS` (3 600 000 ms) before `now` |

- **How the rule reads "a person pushed".** No field the index or the host gives names the pusher. `PrIndexRow.author` is the PR's author, not the head's pusher (`packages/domain/src/entities/pr-index.ts:53`), and the row carries no commit author or committer. Agents and persons also commit under one identity: the master agent's commits on `origin/main` read `Jan Wloka <jan.wloka@quatico.com>` with a `Co-Authored-By: Claude` trailer, and the Writer app pushes only to the default branch. So the rule reads ownership instead of identity:
  - **`owner: 'desk'`** where a worktree on this machine holds the branch (`Trees.forBranch`, as `fixerTick` reads it at `auto-fixer.ts:372`), or where `origin/<base>..origin/<head>` carries a claim marker (`isEmptyClaim`, `packages/domain/src/rules/empty-claim.ts:35`, read through `Refs.commitSubjects`). An agent claimed the branch, so its head is an agent's push, and the desk rules of today decide.
  - **`owner: 'none'`** where neither holds. Every head on such a branch that the fixer did not push counts as a person's push, including a master agent's, because a master agent is a person's live session. Its age is `now − headSince`. `headSince` is the time the fold first saw the head, on this machine's clock (`pr-index.ts:68-75`); it lags the push by at most one PR pass and resets on a rebuilt store, and both errors make the hold longer, never shorter.
- **The fixer walks its own arms.** `fixerPrNext(readings)` in `slice-pr-next.ts` calls `fixerScope` in place of `guardArm`, then `reviewRunArm`, `fixerInFlightArm`, `highArm` and `ciRedArm`, and returns the first answer that is not `none`. For `owner: 'none'` it hands the arms `desk: { dead: true }`, because no agent owns the branch and the quiet hour has passed. For `owner: 'desk'` it hands them the desk reading of today, so a live, waiting or elsewhere desk holds as it does now.
- **Review and merge keep the sprint scope.** `slicePrNext` and `guardArm` do not change, and `auto-review.ts:218` and `auto-merge.ts:378` keep reading `sprintScopeRef`. A unit test proves that `slicePrNext` still answers `out-of-scope` for a PR that `fixerPrNext` takes.
- **The pass.** `readFixerPass` stops reading `sprintScopeRef` (`auto-fixer.ts:677`), and `fixerTick` calls `fixerPrNext` in place of `slicePrNext` (`auto-fixer.ts:378`). The tick reads the claim commits only for a row that passes the checks before `owner-unread`. Every existing refusal stays: the in-flight hold, both budgets, the start lock, the re-ask of the head before the start (`auto-fixer.ts:496-501`), `fixerAdmission` with one fixer at a time, and the 3600 s bound.
- **Unit tests,** one cell per row of the table and these: a PR into `sprint/x` is in; a PR into `release/1` is out; a deskless PR whose head is 59 minutes old holds and one 61 minutes old is in; a fixer-pushed head 5 minutes old is in; a claimed branch with a 5-minute-old head is in with `owner: 'desk'`; a deskless red PR answers the `fixer` step from `fixerPrNext` and `out-of-scope` from `slicePrNext`.

**Slice 2, the conflict kind:**

- **A third finding.** `FixerFindingSchema` gains `{ kind: 'conflict', head, baseTip }` (`fixer-attempts.ts:21-24`), where `baseTip` is the commit that `origin/<base>` pointed at when the attempt started. `FIXER_ATTEMPTS_VERSION` stays 1: an older build reads a record that holds the new arm as unreadable, and an unreadable record holds every fixer on that PR (`fixerInFlight`, `packages/domain/src/rules/fixer-attempts.ts:78-82`). `fixerAttemptsSpent` counts the kind apart from `high` and `ci`, with the same `FIXER_ATTEMPTS_BUDGET` of 2 per PR.
- **The arm.** `conflictArm` runs in `fixerPrNext` before `ciRedArm`, because GitHub runs no `pull_request` checks for a merge ref that conflicts, so a red or pending CI on a conflicting head is not a finding. It answers `none` where `row.mergeable` is not `conflicting`; a hold `conflict-attempted` where an attempt already answered this head and this base tip; a hold `conflict-attempts-spent` where the kind's budget is spent; `none` with `desk-alive` where the desk is not gone, so a desk agent keeps its own conflict ending; otherwise `{ step: 'fixer', head, evidence: 'conflict' }`. `FixerReading` gains `conflictExhausted` and `conflictTried`, and `SlicePrNextReadings` gains an optional `baseTip`, which the tick reads through `Refs` after it fetches the base; an unread tip holds `unread`.
- **The start re-asks.** `startFixer` re-asks `prState` as today and also refuses `not-conflicting` where the host's answer is not `conflicting` (`packages/domain/src/adapters/host/host-shell.ts:122`). It records the base tip it read in the attempt.
- **The brief.** `fixerPrompt` gains the evidence `{ kind: 'conflict', base, baseTip }` (`packages/domain/src/rules/fixer-start.ts:8-10`). The prompt says: fetch the base; merge `origin/<base>` into the detached head with `git merge`, never rebase and never force-push; resolve every conflict; for a generated bundle (`.gitattributes` marks them `-merge`), restore the path from the merge base, `git merge-base HEAD MERGE_HEAD`, and never commit a rebuild (`docs/definition-of-done.md`, *Resolving a board artifact conflict*); stop and report where a conflict sits in a path that the role gate protects (`.github/workflows/`, `.claude/`, `scripts/check-*.sh`), because the fixer may not edit it; commit the merge and push with `git push origin HEAD:<branch>`.
- **The merge arm's word.** `slice-pr-next.ts:395,429` compare against `'CONFLICTING'`. Both read one exported constant holding the stored word `conflicting`, and the fixtures in `packages/domain/test/slice-pr-next.test.ts:540,598` change to it.
- **Bitbucket.** Its rows carry `mergeable` from a local merge-tree check (`packages/domain/src/adapters/host/bitbucket-pr-listing.ts:241`), so the conflict arm works there too. They carry no `ciChecks`, so the CI-red arm stays GitHub-only, as today.
- **Tests:** the schema round-trips the new arm; an old-format reader reads it as unreadable; each `conflictArm` answer; a second conflict on the same head and base tip holds; a new base tip after one attempt starts a second; a third holds as spent; `startFixer` refuses `not-conflicting`; the prompt names the base, the merge-base restore and the protected-path stop; the merge arm holds `conflicting` on a row with the stored word.

**Slice 3, the board names the finding:**

- **The run carries its kind.** `roleRuns` already reads the in-flight attempt's `finding.kind` to count the attempt (`packages/domain/src/rules/agent-roles.ts:93-104`). The `RoleRun` it returns gains `finding: 'high' | 'ci' | 'conflict'`, and `RoleRunSchema` gains the optional field (`packages/board/src/contract/schema.ts:4489-4502`).
- **The row reads the run, not the PR.** `agentRowFactsOf` infers `fixerFinding` from the PR's CI and review today (`packages/board/src/app/lib/agent-rows/delivery-row-facts.ts:158-159`), so a conflict fixer on a green PR would show "fixing". It reads `run.finding` first and keeps the inference for an older server. `fixerFinding` gains `'conflict'` (`packages/domain/src/rules/delivery-row-form.ts:165`), and the By cell shows "fixing conflict ✗" (`delivery-row-form.ts:635`).
- **Tests:** a unit cell per kind for `roleRuns` and for the cell's wording, a cell for a run with no `finding`, and one browser test that the row shows "fixing conflict ✗".

### Open Questions

- [x] Auto-review widens to the fixer's scope (operator decision, 2026-11-20). Slice 4 builds it; the merge arm stays on the sprint scope.

## Slices

### Scope

- `feature/the-fixer-scope-reads-every-open-pr` — `fixerScope` with its reasons, the owner reading from the worktree and the claim marker, the person-push hour read from `headSince`, `fixerPrNext` over the existing arms with a dead desk for an unowned branch, `readFixerPass` without the sprint scope, and the unit tests <!-- builds: fixerScope and fixerPrNext, the fixer's own scope and arm walk --> → #3600

### Conflict

- `feature/the-fixer-merges-the-base-into-a-conflicting-pr` — the `conflict` finding with its base tip, `conflictArm` before `ciRedArm`, the `not-conflicting` re-ask, the conflict brief with the merge-base restore and the protected-path stop, the merge arm's `conflicting` word, and the tests <!-- builds: conflictArm, the fixer's conflict finding --> <!-- waits: feature/the-fixer-scope-reads-every-open-pr -->

### Board

- `feature/the-fixer-row-names-its-finding` — `RoleRun.finding` from the in-flight attempt, `agentRowFactsOf` reading it before the PR-state inference, and "fixing conflict ✗" <!-- builds: RoleRun.finding, the fixer kind on the Delivery row --> <!-- waits: feature/the-fixer-merges-the-base-into-a-conflicting-pr -->

### Review

- `feature/the-review-reads-the-fixer-scope` — `reviewPrNext`: `repairNamesPr` first, as `guardArm` does today, then the fixer's scope rule (renamed for both roles), then `reviewRunArm`, `restatusArm` and `reviewArm`; auto-review calls it instead of `slicePrNext`, the merge arm keeps `slicePrNext` and the sprint scope, with a test that proves merge still answers `out-of-scope`; the domain and fleet test cells the testability verdict names <!-- builds: reviewPrNext, the review arm walk over the fixer scope --> <!-- waits: feature/the-fixer-scope-reads-every-open-pr -->

## Notes

- Created by `/plot-idea` on 2026-11-20 from the operator's requirement. Type `feature`, review `pr`, implementation `own branches`, and the design question was answered no, so the plan starts in Draft.
- Scope decision (operator, 2026-11-20): every open, non-draft PR into the default branch or a `sprint/*` branch, except release PRs, is in the fixer's scope, and a PR whose head a person pushed within the last hour is skipped, so that the fixer never races a person at work.
- The repair and revert branches are out by name because their roles own them and claim them (`packages/fleet/src/shared/repair-start.ts:214`); a claimed branch alone would make them `owner: 'desk'`, and a dead repair desk would then get a second writer.
- `fixerAdmission` admits one fixer at a time across the machine, so a wider scope makes a queue, not more concurrent fixers. The tick walks the rows in index order.
- Pre-flight, 2026-11-20: no plan file and no branch has the slug; no Draft, Design or Approved plan shares three significant title words; `plot-deliverable-search.sh` found nothing named `fixerScope`, `fixerPrNext`, `conflictArm` or `personPushedRecently`.

- **Operator decisions (2026-11-20).** A PR that carries the label `plot:hands-off` gets no review, no fixer and no conflict repair from the fleet, and the board names `hands-off` as its hold reason; removing the label ends the opt-out. On a PR owned by no agent, the fixer acts on HIGH review findings, red CI and conflicts once the quiet hour has passed; lower findings stay review comments. `idea/*` plan PRs stay out of the fixer and review scope.
- **Panel round 1 builder notes (unanimous `amend`, no reject; full text in `.plot/panels/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr/panel.md`).**
  - Only fleet evidence makes `owner: 'desk'`: a registry manifest or the claim marker. A worktree made by hand, with no worker records, is `owner: 'none'` and waits the hour (`deskDeadFromWorkerState`, `auto-fixer.ts:164-176,371-374`). Slice 1.
  - A pure `fixerOwner` rule answers `desk`, `none` or `unread`; a failed `forBranch` or `commitSubjects` read is `unread` and starts nothing, with one `fixerTick` test (`auto-fixer.ts:372-373`). Slice 1.
  - A claimed branch with no desk on this machine (`elsewhere`, `auto-fixer.ts:374`) becomes fixable once its claim is older than `Claim stale after` and the quiet hour has passed. Slice 1.
  - Every hold reason (`person-pushed-recently` with the time left, `hands-off`, `repair-owned`, `base-out-of-scope`, `conflict-attempted`, `owner-unread`) reaches the run log and the Delivery row as a row property with unit tests (`auto-fixer.ts:378-381`). Slice 3.
  - Each slice names its `auto-fixer.test.ts` cells: `:59` passes `scope`, which slice 1 removes; the world's `refs` pick needs `commitSubjects` (`auto-fixer.ts:63`); `:650` and `:665` change reason. The failed-start hold keys on head and base tip (`auto-fixer.ts:383`). Slices 1 and 2.
  - `not-conflicting` refuses before the attempt is written, so GitHub's `UNKNOWN` window after a base move spends no attempt; reuse `MergeabilitySchema` (`entities/pr.ts:21`); the merge-word fix also updates `slice-pr-next.test.ts:655,709`. Slice 2.
  - The conflict brief cites `rolePushViolation` (`role-gate.ts:192-236`) and stops when its push is refused; a `State:` conflict stops at `plot-state-gate.sh` and is reported, not retried. Slice 2.
  - `readFixerPass` must not default the base to `'main'` (`auto-fixer.ts:675`), so `base-unread` can fire. A 60-minute boundary cell. State whether `fixerPrNext` drops `restatusArm`. An older board hides a `conflict` run silently while `FIXER_ATTEMPTS_VERSION` stays 1; `fixerReadingOf` gets base-tip cells. Fork PRs carry no head-repository field and are out of scope until one exists. Slice 3 names `delivery-row-adapter.test.ts`.
  - Review widening (slice 4): review spend grows under the unchanged budget (`REVIEW_START_BUDGET` 3 per head, `REVIEW_BOUND_MS` 1 h); a spent HIGH now opens tickets for PRs no plan names (`slice-pr-next.ts:275-287`); the review re-ask needs no change (`pr-refresh.ts:1596-1604`).
