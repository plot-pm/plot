## Implementation brief — a-release-holds-merges-while-it-waits (wave 1: Person Hold)

- **Plan (canonical):** docs/plans/2026-11-27-a-release-holds-merges-while-it-waits.md on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-person-holds-merges-for-a-release` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per the plan's `Review: pr`

This is wave 1. Wave 2, `bug/a-release-holds-merges-on-its-own` (the automatic hold), waits on this branch and reads `releaseHoldable`, `release-hold-person.json` and the `release-waiting` hold in `mergeArm` and `mergeAt` from it. Build the person hold only: no `Release hold` config key, no `advanceReleaseHold`, no `release-hold.json`.

**State on main (2026-11-28).** #3746 merged an earlier design on `bug/a-waiting-release-holds-merges` and #3766 reverted it (`fa885117a`). Main holds no `rules/release-hold.ts`, no `ReleaseHoldStore` port, no `release-hold` entity and no `release-waiting` reason. Do not restore the reverted files. That design started the hold itself at green CI; this plan starts it from a person. The old brief `.plot/briefs/a-waiting-release-holds-merges.md` describes the reverted design and is wrong for this branch. The new branch name exists because the wave gate reads the old branch as merged.

### What to build

Changesets rebuilds the release PR after every push to main, so every fleet merge gives it a new head. Measured 2026-11-26: release PR #3719 got 14 heads between 14:33:17 and 20:37:05 UTC. On `e150fd7c1`, `validate` passed at 20:30:57, #3738 merged at 20:33:37, and `a232b0959` replaced the head at 20:34:34. The review on `e150fd7c1` went `success` at 20:36:00 on a head that was no longer the release head. The fleet merged nothing for the 11 h 18 min after the operator stopped it. Your change lets a person press "Hold merges, I am approving now" and holds every merge into the default branch as `release-waiting` for at most `Checks wait`.

Build these parts. The plan's `## Design › Approach` is canonical; this is orientation.

1. **`releaseHoldable(row, headChanges)`**, exported from `packages/domain/src/rules/release-prepare.ts` beside `releaseReviewStep` (arrow function, factual TSDoc). It answers `holdable` for an OPEN `changeset-release/` row into the default branch with a `headSha`, `ciChecks` counted on `checksSha === headSha` (`ciCounted`, `rules/release-checks-counted.ts`, the criterion `releaseApprovable` reads at `rules/release-approvable.ts:65`), a trusted `plot/review` (`trustedReview`, `rules/pr-index.ts`) on the head that is absent, `pending` or `success`, and head changes that read clean or are unread. Otherwise it names the first unmet criterion. It reads no scope.
2. **The person hold and its lift.** `POST /api/release-hold` and `plot-ask.mjs release-hold <sha>` write `{ pr, act: hold, head, at, by }` to `.plot/state/release-hold-person.json`, after `releaseHoldable` answers `holdable` for that head. `POST /api/release-hold-lift` and `plot-ask.mjs release-hold-lift <sha>` write `act: lift` naming the head. A lift for another head lifts nothing; a lift for a head the file does not name refuses. The controllers are the one writer; each act is one whole-file write (copy the shape of `adapters/repair-record/repair-record-file.ts`: rename, `ENOENT` reads `null`, an unparseable or other-version file reads `null`). fleetd only reads the file. Both commands refuse `PLOT_UNATTENDED=1`; the controller gate (`packages/domain/src/rules/controller-gate.ts`, `packages/board/src/server/entry/gate.ts`) refuses a shell `curl` of both routes. Follow `packages/board/src/server/entry/release-approve.ts` and `plot-ask.mjs release-approve` for the route and command shape.
3. **The hold in `mergeArm`** (`packages/domain/src/rules/slice-pr-next.ts:498`). Add `'release-waiting'` to `HoldReason` (`:162`) and a release reading to `SlicePrNextReadings`. The merge pass runs apart from the release tick (`packages/fleet/src/shared/auto-writes.ts:127`), so `mergeArm` reads the release PR's index row and the person file; wire the readings where fleetd builds the merge tick's readings (`packages/fleet/src/shared/auto-merge.ts`). Place the check for a PR whose `base` is the default branch that `holdsApply` accepts, after `default-branch-red`, `default-branch-stale`, `default-branch-unsettled` and `merge-in-flight`, and before `conflicting` and the merger-app holds. A PR into a `sprint/` base, the release PR itself, and a PR that `repairAdmitted` admits are not held. An absent or non-OPEN row, a missing or unparseable file holds nothing.
4. **The hold in `mergeAt`** (`packages/domain/src/workflows/merge.ts`). `plot-ask.mjs merge` refuses `release-waiting` for a PR into the default branch while the hold holds, and merges a PR into `sprint/x`. A person's merge on the host stays out of scope.
5. **The board shows the hold.** *Waiting on you* lists `release #<n> holds merges until <end>`; the release row reads `holds merges since <since> · ends <end>`; a held slice PR's Status word reads `release-waiting`. "Hold merges, I am approving now" and "Lift the hold" always show, disabled with their reason (`ReleaseApprove.tsx` and `packages/board/src/app/lib/release-approve.ts` are the neighbours). Every decision is a domain property: each text and each disabled state is computed in `packages/domain/src/rules/` and unit-tested, with one browser test that the row shows. If a table of hold wordings exists and a test demands an entry for every `HoldReason`, add the one entry and report it.
6. **The `localhost` limit shows at both buttons.** `RP_ID` is `'localhost'` and the board verifies only `http://localhost:<port>` (`packages/board/src/server/passkey.ts:110`, issue #3750). On any other origin, "Approve release" and "Hold merges, I am approving now" are disabled with the reason that the passkey works only on `http://localhost:<port>` and name the local board as the route.
7. **`CLAUDE.md`** gains one paragraph under "A Decision Reads The Index" for the person hold: the merge arm decides from a non-terminal answer, the hold is reversible, bounded by `boundMs`, and an absent or non-OPEN row holds nothing, so the index never says no. Then run `./scripts/check-agents-md.sh --write` so `AGENTS.md` follows.

### Settled decisions — do not re-derive them

**Readiness reads `releaseHoldable`, not the release stage.** `releaseStage` answers `waiting-scope` (`release-prepare.ts:228-229`) before it reads checks or the review, and on 2026-11-26 both `e150fd7c1` and `8e1373e0f` read `waiting-scope`. `releaseApprovable` does not read the stage, and #3719 was approved in `waiting-scope`. A hold gated on the stage holds nothing in the measured case. This is the mistake the replay test below catches.

**The hold is time-bounded across heads, not per head.** The hold covers merges from `at` until `at + boundMs` (`Checks wait`, 3600 s here), across new heads of the same release PR. A new head at `T + 10 min` does not extend it. No new duration key: `Checks wait` is the bound until a measurement shows the two need different values (`[question-bound-value]`).

**Five stages end a hold; the merge arm reads no head changes.** `merged`, `publishing`, `released`, `failed` and `release-head-foreign` end it, as does the lift and the bound. `publishing`, `released` and `failed` follow a merge, so a MERGED row ends the hold before them. In the merge arm `release-head-foreign` cannot end a hold; the lift and the bound do.

**A person starts it; fleetd never writes it.** The automatic start is wave 2's, behind a config key. Do not add it here, and do not let fleetd write `release-hold-person.json`. The file holds a fact (`pr`, `act`, `head`, `at`, `by`); the hold itself is derived each pass, never stored as `holds: true`.

**The direct pushes stay.** Dispatch's `book the brief and plan start` and `plot-open-pr.sh`'s `record PR` still move the release head during a hold (4 of 14 heads, no merge before them). A person hold covers the new head. Do not hold dispatch bookings (`[question-direct-pushes]`).

**Open question `[question-ready-notice]` is not answered by the plan.** `releasePrepareNext` notifies only past `waiting-scope` (`release-prepare.ts:343-345`). The plan recommends notifying once per head in `waiting-scope` where the CI and review criteria hold. Leave it out of this branch unless the plan answers it before you start; report that you left it out.

**Rules carried over unchanged.** Absent is not false: a missing store, a missing row, an unparseable file or an unread config holds nothing, because a hold stops work and an unread input must never start one. Read the exit code, not the emptiness. The release PR is never a slice PR; `fleet-scan.ts`'s scope already classes it as a release, so the arm must not hold the release row on its own hold. Two release rows: pick the one into the default branch.

### Done when

The plan's `## Done when` is the specification, with the slice's `tests:` comment as its list. The assertions that exist because a naive implementation passes without them:

- **Replay of 2026-11-26 20:30:57–20:34:34 UTC** with a scope plan not Delivered (`waiting-scope`), the index row with `ciChecks` counted on `e150fd7c1` and no review, and a person hold taken at 20:31: #3738 reads `release-waiting` at 20:33:37. Catches a hold gated on the stage or on a `success` review.
- A `waiting-scope` release with a green, unreviewed head is `holdable`.
- Each of `merged`, `publishing`, `released`, `failed` and `release-head-foreign` ends a hold.
- A hold pressed at `T` holds at `T + boundMs − 1` and not at `T + boundMs`. Catches an off-by-one on the bound.
- A new head at `T + 10 min` does not extend the hold past `T + boundMs`. Catches a rule that resets `at` per head.
- A lift names its head; a lift for another head lifts nothing; a lift for a head the file does not name refuses.
- On a red main, the repair PR and the revert PR merge while the hold holds. Catches a hold that starves the repair.
- A `sprint/x` PR and the release PR are not held; two release rows pick the one into main.
- `mergeArm` order against each default-branch hold, `merge-in-flight` and `conflicting`.
- `plot-ask.mjs merge` refuses `release-waiting` for a PR into main and merges a PR into `sprint/x`.
- Both new commands refuse `PLOT_UNATTENDED=1`; the gate refuses `curl POST /api/release-hold` and `/api/release-hold-lift`.
- Each button's disabled reason, the non-`localhost` reason, the *Waiting on you* row, the release row text and the Status word are unit-tested domain properties, plus one browser test that the row shows.

Plus the repo's gates: a changeset for `plot` (patch, since this is a bug fix) with the description first and the `bumps:` block last, and the optional `plan:` line naming this plan; `pnpm build:board` output is never committed (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This branch should touch no `.sh` file; `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, and it counts commands, not lines. If you must touch a `.sh` file, remove shell elsewhere in the same change or write the rule in the domain and ask it through a bundle. New code is arrow functions. The purity gate allows the domain to import `zod` only outside `adapters/`, and `scripts/check-bundle-resolution.sh` and `scripts/check-launcher-bundles.sh` apply to a new bundle entry.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Person Hold` in the plan's `## Slices` section. Do not hand-edit `State:` lines.

### Scope guard

This branch owns `release-prepare.ts` (the `releaseHoldable` export), a new rule file for the hold's wording and bound under `packages/domain/src/rules/`, `HoldReason` and `mergeArm` in `slice-pr-next.ts`, `mergeAt` in `workflows/merge.ts`, a new port and file adapter for `release-hold-person.json`, `packages/fleet/src/shared/auto-merge.ts` (the readings only), the two controllers and routes under `packages/board/src/server/entry/`, `plot-ask.mjs`, the controller gate, the release row and its two buttons under `packages/board/src/app/`, `CLAUDE.md` with its generated `AGENTS.md`, and the changeset.

`bug/a-release-holds-merges-on-its-own` (wave 2) owns the `Release hold` key, `advanceReleaseHold`, `release-hold.json` and fleetd's write of it. Do not touch them. Its brief on main names `bug/a-waiting-release-holds-merges` as the branch it waits on; the plan names this branch, so treat the plan as right.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
