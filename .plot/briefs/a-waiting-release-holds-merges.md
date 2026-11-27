## Implementation brief — a-release-holds-merges-while-it-waits (wave 1: Hold)

- **Plan (canonical):** docs/plans/2026-11-27-a-release-holds-merges-while-it-waits.md on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-waiting-release-holds-merges` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per the plan's `Review: pr`

This is wave 1. Wave 2, `bug/the-board-shows-the-release-hold`, waits on this branch and adds the board row, the lift route and the lift command. This branch writes no board code and no lift controller.

### What to build

Changesets rebuilds the release PR after every push to main, so every fleet merge gives it a new head. Measured 2026-11-26: release PR #3719 got 14 heads between 14:33 and 20:37 UTC. On `e150fd7c1`, `validate` passed at 20:30:57 and the review started at 20:34:34, but `a232b0959` replaced the head at 20:34:34 — the review ran on an old head. `releaseApprovable` (`packages/domain/src/rules/release-approvable.ts:65`) never enabled the passkey button for long enough. The operator stopped the fleet and the release merged 9 hours later. Your change makes fleetd's merge arm hold merges into the default branch while a release head is ready and waits.

Build three things, all in this branch:

1. **`releaseHold(release, record, now, boundMs)`**, a domain rule in `packages/domain/src/rules/` (arrow function, factual TSDoc). `release` is the release PR's OPEN index row, or `null`. `record` is the hold record, or `null`. It answers `holds`, or `none` with a reason. The release row must be open, its `headRef` must start with `changeset-release/` (`RELEASE_BRANCH_PREFIX`, `rules/loose-delete.ts:25`), its `base` must be the default branch, `ciChecks` must read counted-green on `checksSha === headSha` (reuse `ciCounted` from `release-checks-counted.ts`, as `releaseApprovable` does), and the review must be a trusted reading (`trustedReview`, `rules/pr-index.ts`) naming the same head. The record must name no lift for this head, and `now - since` must be under `boundMs`. A head with no record yet reads as beginning at `now`.
2. **`mergeArm` holds as `release-waiting`** (`packages/domain/src/rules/slice-pr-next.ts:481`). Add `'release-waiting'` to `HoldReason` (`:162`), a `releaseHold` reading to `SlicePrNextReadings`, and the check inside the branch that `holdsApply(base, defaultBranchName)` accepts, after the default-branch checks and before the merge identity. A PR into a `sprint/` base takes the other branch of `mergeArm` and is not held. The PR that `repairMerge` admits (`repairAdmitted`) is not held: a red main still gets its repair. An absent `releaseHold` reading holds nothing.
3. **fleetd keeps the record.** A `ReleaseHoldStore` port in `packages/domain/src/ports/`, a file adapter under `packages/domain/src/adapters/release-hold/` for `.plot/state/release-hold.json` (`{ head, since, liftedBy? }`; copy the shape of `adapters/repair-record/repair-record-file.ts`: whole-or-nothing rename, `ENOENT` reads `null`, an unparseable or other-version file reads `null`), and the write where fleetd builds the merge tick's readings (`packages/fleet/src/shared/auto-merge.ts`, near the `defaultBranchFile(home)` read, line ~374). That site reads the release row from the same OPEN rows it already holds, reads the record once per tick, and writes a new record with `since: now` when the rule answers `holds` for a head the record does not name. fleetd writes nothing else.

### Settled decisions — do not re-derive them

**The record holds a fact, not a verdict.** The hold itself is derived each pass from the index row and the record. CLAUDE.md "A Decision Reads The Index" keeps `default-branch.json` as the one sanctioned verdict file; this file is not a second exception, because it stores only `since` and a lift, both facts that no other source holds. A persisted `holds: true` would be a verdict that goes stale when the head moves.

**The bound is `Checks wait`, with no new config key.** Read it as `checksWaitMsOf(readConfig(opts, 'Checks wait', '3600'))` — `auto-merge.ts` already computes `checksWaitMs` for the same tick, so pass that value. Measured need: the 2026-11-26 heads needed about 5 min for CI plus review, so 3600 s covers it with margin. A separate key waits for a measurement that shows the two bounds differ.

**The hold ends three ways, and each has a test.** The release row is MERGED or closed (the rule takes an OPEN row only). A lift for this head (`liftedBy` set and the record's `head` equals the row's `headSha`; the lift writer is wave 2, so test it with a record fixture). `boundMs` elapsed since `since`. **An expired head is not held again:** the record keeps `head` and `since` after expiry, so the next pass reads the same head with an old `since` and answers `none`. A new head has no record and starts a new hold only once it passes the readiness test.

**Open question `[question-hold-before-review]` — implement the plan's recommendation, and say so in the PR.** The plan's Approach says the hold begins once the review reads `success`. Its open-question recommendation says to begin at green CI and a review that is `pending` or `success` on the head. Measured on 2026-11-26, the review was the step that lost the race: `a232b0959` replaced `e150fd7c1` during the review. A hold that begins only after `success` would not have held on that head. Implement the recommendation: the review reading must name the head and read `pending` or trusted `success`; `absent`, `failure` and `unchecked` do not hold. Keep the `since` from the first pass that holds. If you find a reason the recommendation fails, stop and report it instead of choosing the Approach wording silently.

**`[question-person-merge]` is out of scope.** The hold binds fleetd's merge arm. `plot-ask.mjs merge` and a person's merge on GitHub do not read it. Do not add a hold to `mergeAt` (`packages/domain/src/workflows/merge.ts`).

**Rules carried over unchanged.** Absent is not false: a missing store, a missing row, an unparseable record or an unread config holds nothing — a hold stops work, so an unread input must never start one. Read the exit code, not the emptiness. The index never says no: `releaseHold` reads an OPEN row and never infers "no release PR" from an empty list. The release PR itself is never a slice PR; `fleet-scope.ts` already classes it as a release, so the arm that reads it must not hold the release row on its own hold.

### Done when

The plan's tests list is the specification:

- A green, reviewed release head holds a slice PR into main as `release-waiting`.
- A PR into `sprint/x` is not held. Catches an implementation that puts the check before `holdsApply`.
- The PR the repair record names is not held while main is red. Catches a hold that starves the repair.
- The hold ends past `Checks wait`, on a lift for the head, and when the release row is MERGED.
- An expired head is not held again. Catches a rule that resets `since` on every pass; the naive version passes the first three tests and fails only this one.
- A lift for another head does not lift this one.
- A pending review on a green head holds (the open-question recommendation); an absent, failed or unchecked review does not.
- The writer writes the record once per head: two ticks on the same head leave `since` unchanged.

Plus the repo's gates: a changeset for `plot` (patch — this is a bug fix), with the description first and the `bumps:` block last, and the optional `plan:` line naming this plan. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This branch should touch no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. New code is arrow functions; the purity gate allows the domain to import `zod` only outside `adapters/`.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Hold` in the plan's `## Slices` section. CLAUDE.md "A Decision Reads The Index" gains one paragraph for `release-hold.json`; then run `./scripts/check-agents-md.sh --write` so `AGENTS.md` follows.

### Scope guard

This branch owns `packages/domain/src/rules/release-hold.ts` (new) and its test, `HoldReason` and `mergeArm` in `packages/domain/src/rules/slice-pr-next.ts`, the new port and adapter for `release-hold.json`, `packages/fleet/src/shared/auto-merge.ts` (the readings and the one record write), `CLAUDE.md` with its generated `AGENTS.md`, and the changeset.

`bug/the-board-shows-the-release-hold` (wave 2) owns the release row text, the "Lift the hold" button, `POST /api/release-hold-lift`, `plot-ask.mjs release-hold-lift` and the controller gate. Do not touch `packages/board/` or `plot-ask.mjs`. Define the record's `liftedBy` field in the entity so wave 2 writes it without a shape change. The Status word for a held slice PR (`release-waiting`) follows from the `HoldReason` string; if a table of hold wordings exists in `packages/board/` or `packages/domain/src/rules/plan-card-facts.ts` and a test demands an entry for every `HoldReason`, add that one entry and report it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
