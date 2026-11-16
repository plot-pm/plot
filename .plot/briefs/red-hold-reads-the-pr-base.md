## Implementation brief — red-hold-reads-the-pr-base (slice: Base hold)

- **Plan (canonical):** docs/plans/2026-11-09-red-hold-reads-the-pr-base.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3323 merged
- **Branch:** `bug/red-hold-reads-the-pr-base` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** the `plot/review` check on the PR head, per the plan's `Review: pr`

This is slice 2 of 4. `bug/red-hold-index-base` merged (#3479, `597e0b790`): `PrIndexRowSchema` carries `base` and `PR_INDEX_VERSION` is 7. This slice reads that field. `bug/red-hold-base-readings` waits on this slice and writes the per-base files this slice only reads.

### What to build

Issue #3322: on 2026-11-09 `main` went red on `ca37e53ba`, and three reviewed slice PRs into `sprint/desk-probes-and-liveness` (#3313, #3316, #3319) stayed held `default-branch-red` until a person merged them on GitHub. `plot-ask.mjs merge` is already fixed (`5b372db9d`): `merge` and `mergeAt` apply the default-branch holds only where `holdsApply(base, defaultName)` is true (`packages/domain/src/workflows/merge.ts:200`, used at `:343` and `:532`). fleetd's merge arm is not fixed. `mergeArm` (`packages/domain/src/rules/slice-pr-next.ts`, the function that holds `default-branch-unread`, `-stale`, `-red`, `-unsettled` and `merge-in-flight`) reads `readings.defaultBranch` and never `row.base`, so a PR into a sprint branch is held by `main`'s red before `mergeAt` runs.

Build four things, all synchronous domain code plus one file reader:

- **`baseBranchRed(base, baseReading, now, checksWaitMs): boolean`** in `packages/domain/src/rules/default-branch.ts`. It returns true where `defaultBranchRed(baseReading, now, checksWaitMs)` (`:281`) holds and `baseReading.branch === base`. It applies nothing else.
- **`baseBranchFile(repoRoot, base): DefaultBranchStore`** in `packages/domain/src/adapters/default-branch/`, exported from `adapters/index.ts` next to `defaultBranchFile`. It reads `.plot/state/base-branches/<base>.json` in the existing `DefaultBranchReadingSchema`. A file whose `branch` is not `base`, and a `base` with an empty or `..` segment, read as `answered(null)` — no reading. A missing file is `answered(null)`; a failed read is `failed`. This slice needs no `write` that fleetd calls (the next slice writes), so implement `write` as the same atomic temp-and-rename of `defaultBranchFile` to satisfy the port, but guard the path the same way and refuse (`failed`) an invalid base.
- **`base-branch-red`** as a new `MergeRefusal` (`merge.ts:34`) and a new `HoldReason` (`slice-pr-next.ts`, the union). `MergeReadings` gains `baseReading: DefaultBranchReading | null | 'unaskable'`. In `merge`, where `holdsApply` answers false, call `baseBranchRed` with `pr.base`; refuse `base-branch-red` with the detail `sprint/x is red on <12-char sha>. A merge now stacks a change on an unproven base.` (name the base, same `short()` helper), and refuse `unaskable` on a failed read, as the default-branch read does. `mergeAt` reads the base's file after `prState` where `holds` is false, through a new optional `MergePorts.baseBranch?: (base: string) => DefaultBranchStore`; absent reads as no reading. It reads no tip.
- **`mergeArm`** reads `row.base` and a new `SlicePrNextReadings.defaultBranchName` and `.baseReading`, calls `holdsApply` first, and where it answers false skips every default-branch check (`unread`, `stale`, `red` with its repair arm, `unsettled`, `merge-in-flight`) and holds only `base-branch-red`. `conflicting` and `mergeIdentity` still apply to both paths. A row with no `base` reads `''`, which keeps the default-branch path. `auto-merge.ts` (`mergeTick`, `buildTick` near `:298`) reads one base file per distinct non-default base among the open rows — a file read, no process — and passes the reading for each row's base. `holdsApply` is exported from the workflow; import it into the rule only if the layering allows (`rules/` may not import `workflows/`) — if not, move `holdsApply` into `rules/` and re-export from `merge.ts`, so one definition serves both.

Also update `CLAUDE.md`: the paragraph *One hold reads a non-terminal answer* says fleetd's selection (`mergeArm`) "still holds every PR on the default-branch holds whatever its base". Replace that clause with the new behaviour, then run `./scripts/check-agents-md.sh --write` so the `AGENTS.md` mirror follows.

### Decisions the plan settles — do not re-derive them

**A sprint base applies the red hold only (decided 2026-11-10).** `default-branch-stale`, `-unsettled`, `-unread` and `merge-in-flight` describe the default branch's tip and stay on the default-branch path. A base reading older than `Checks wait` holds nothing, exactly as `defaultBranchRed` already says for `main`. Do not add a stale hold for a base: a missing or old reading must lift the hold, because a base with no sprint PR open never gets a settled commit (`ancestorsToAsk` asks nothing without one) and would otherwise hold forever.

**A base with no reading holds nothing.** This slice ships before any file exists (the next slice writes them), so with no base file every PR into a sprint branch is held by nothing. That is the intended interim state: the plan's Notes say so.

**The base is read from the index row, never from the host, in `mergeArm`.** `mergeArm` is selection and may not ask the host; `mergeAt` re-asks `prState` before the merge and decides again. The index can supply `base` and never says "no base": a row with `base` absent (a v6-era row cannot exist — the store is v7 — but a Bitbucket or listing arm may emit none) reads `''` and keeps the default-branch holds. Absent is not a different branch.

**One file per base, the default branch's file unchanged.** Rejected: one keyed file for all bases — two refreshes would race on one read-fold-write. Rejected: reading the base's reading from `default-branch.json` with a `branch` filter — its single writer overwrites it with the default branch.

**The repair exception does not move.** `repairMergeVerdict` stays inside the `holdsApply`-true path in `merge` and `mergeArm`. Every existing repair row in `slice-pr-next.test.ts` and `workflows-merge.test.ts` passes unchanged. The per-base repair arm is the fourth slice; do not start it.

**The queue, the IndexMonitor finding and the board's status line stay on the default branch** (`whyNotReady` in `queue.ts:594`, `index-findings.ts:167`, `defaultBranchStatus`). Every existing `whyNotReady` row passes unchanged.

Invariants carried over: *the index never says no* — a missing or unreadable base reading means no hold, and a failed read in `merge` refuses `unaskable` rather than reading as absent; a hold reads recorded state and spawns nothing, so `mergeArm` makes no call; a refusal ends the action, so `mergeTick` must not proceed past `base-branch-red`.

### Done when

The plan's `## Done when` rows with slice *Base hold* are the specification:

- a `slicePrNext` row: open row with `base: 'sprint/x'`, `main` settled red, no `sprint/x` reading, review `success` on the head, selects `merge`;
- a `slicePrNext` row: PR into `main`, `main` settled red and fresh, not named by the repair record, holds `default-branch-red`;
- a `slicePrNext` row: a row with no `base` and `main` red holds `default-branch-red`;
- every existing repair row in `slice-pr-next.test.ts` passes unchanged;
- a `merge` row and a `slicePrNext` row: PR into `sprint/x` with a fresh settled-red `sprint/x` reading refuses or holds `base-branch-red`, the detail names `sprint/x`, and the same reading older than `Checks wait` holds nothing;
- every existing `whyNotReady` row passes unchanged.

Add these because a naive implementation passes without them:

- **A sprint PR on a stale or unread `main` reading selects `merge`.** Catches a `mergeArm` that adds the base check but leaves `default-branch-unread`/`-stale` ahead of it.
- **A sprint PR with `settled.sha !== defaultBranch.headSha` is not `merge-in-flight`.** Catches a `merge-in-flight` check left on the shared path.
- **A sprint PR whose base reading names another branch holds nothing.** Catches a reader that trusts the file name over its `branch` field. Add the `baseBranchFile` rows for a mismatched `branch` and a `..` segment.
- **A repair PR named in the record, but into `sprint/x`, gets no repair admission.** Catches the repair arm leaking onto the sprint path.
- **An `auto-merge.test.ts` row** where the tick selects a sprint PR on a red `main` and `mergeAt` merges it with the base file read — it proves selection and merge-time agree, which `:162` proves for the default branch only.

Plus the repo's gates: no bundle in the diff (`board-server.mjs` is generated; never commit a rebuild), and a changeset (`'plot': patch`, description first, `bumps:` block last, `plan: docs/plans/2026-11-09-red-hold-reads-the-pr-base.md`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` is not at risk unless you touch a `.sh` file; this slice should touch none. New functions are arrows (`export const f = (…) => …`), and TSDoc says what an export does, not the history of the decision.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Base hold` in the plan. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/default-branch.ts`, `rules/slice-pr-next.ts`, `workflows/merge.ts`, `adapters/default-branch/` (the new reader and its export), `packages/fleet/src/shared/auto-merge.ts`, the matching tests (`default-branch.test.ts`, `default-branch-file.test.ts`, `slice-pr-next.test.ts`, `workflows-merge.test.ts`, `auto-merge.test.ts`), `CLAUDE.md` with its `AGENTS.md` mirror, and the changeset.

Other branches in flight, verified 2026-11-16 against `origin/main`:

- `bug/an-exhausted-episode-admits-its-repair-pr` (PR #3476) edits `rules/repair-pr.ts`, `repair-pr.test.ts`, `slice-pr-next.test.ts` and `workflows-merge.test.ts`. Expect a test-file merge conflict; resolve it by keeping both sets of rows. Do not change `repairMergeVerdict` or `rules/repair-pr.ts`.
- `bug/red-hold-base-readings` (next slice) owns `refs-remote-git.ts`, `default-branch-refresh.ts` and `registryd-main.ts`'s beat. Touch none of them: fleetd writes no base file in this slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
