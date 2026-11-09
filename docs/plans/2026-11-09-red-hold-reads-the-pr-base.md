# The red hold reads the PR's base

> A pull request into the default branch is held by the default branch's settled CI reading, as today. A pull request into a `sprint/**` branch is held by that branch's own reading, which fleetd keeps beside `.plot/state/default-branch.json`, and a base with no reading holds nothing.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3322
- **Review:** pr
- **Impl:** own branches

## Changelog

- A red `main` no longer holds a pull request into a sprint branch. `plot-ask.mjs merge` and fleetd's merge arm read the pull request's base and apply the default branch's holds only to a pull request into the default branch.
- A pull request into a sprint branch is refused `base-branch-red` while that branch's own settled CI reading is red. fleetd keeps one reading per `sprint/*` branch in `.plot/state/base-branches/`.
- The PR index records each pull request's base branch (`PR_INDEX_VERSION` 7).

Board impact: none on the plan format, the template, the helper scripts' interfaces or the `docs/plans` layout. The board's default-branch status line and the IndexMonitor's `default branch red` finding stay about the default branch.

## Motivation

Issue #3322 records the defect. On 2026-11-09 `main` went red on `ca37e53ba`. While it stayed red, `plot-ask.mjs merge` refused three reviewed slice PRs into `sprint/desk-probes-and-liveness` with `default-branch-red`: #3313, #3316 and #3319. Their base was the sprint branch, which forked from `main` before the red commit, so `main`'s red said nothing about them. A person merged all three on GitHub to get past the hold.

Every reader of the hold reads `.plot/state/default-branch.json` and never the pull request's base:

| Reader | Where | What it reads |
|---|---|---|
| The merge decision | `merge`, `packages/domain/src/workflows/merge.ts:251-284` | `readings.defaultBranch`; `default-branch-red` at `:269` |
| The merge controller | `mergeAt`, `merge.ts:396-416` | the default branch's reading and tip, before any PR call; `default-branch-unsettled` on a moved tip |
| fleetd's merge arm | `mergeArm`, `packages/domain/src/rules/slice-pr-next.ts:354-379` | `readings.defaultBranch`; `default-branch-red` at `:371` |
| fleetd's merge pass | `packages/fleet/src/shared/auto-merge.ts:242-263` | `defaultBranchFile`, `requireReading: true` |
| The queue | `whyNotReady`, `packages/domain/src/rules/queue.ts:584` | `defaultBranchRed` from `registryd-main.ts:974-977` |
| The IndexMonitor | `indexFindings`, `packages/domain/src/rules/index-findings.ts:167` | the `default branch red` finding |
| The board | `defaultBranchStatus`, `packages/domain/src/rules/default-branch.ts:356` | the status line |

One writer keeps the reading: `refreshDefaultBranch` (`packages/fleet/src/shared/default-branch-refresh.ts:254`), run on fleetd's PR beat from `registryd-main.ts:3048-3095`. It reads the tip with `git ls-remote origin refs/heads/<default>` (`refsRemoteGit.remoteSha`, `packages/domain/src/adapters/refs/refs-remote-git.ts:86-98`), asks `runsForSha`, and writes the repair record on the change from green to red (`default-branch-refresh.ts:333`).

The PR index cannot tell fleetd a pull request's base: `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts:30-155`) has no base field, and the `pr-list` arms of `plot-host.sh` (`:4739`, `:4784`, `:4815`, Bitbucket at `:4934`) do not ask for one. `prState` does answer it (`Pr.base`, `packages/domain/src/entities/pr.ts:58`).

## Design

This plan has no `Story:`. It belongs to sprint `desk-probes-and-liveness` at tier Should (decided 2026-11-09, jwloka); the sprint writer adds the `Sprint:` line.

It shares files with two plans of the sprint:

- `github-reads-in-process` moves the GitHub `pr-list` read in-process (`rules/github-pr-row.ts`, its *PR reads* slice) and `runsForSha` (its *Issues and runs* slice). Whichever merges second carries the index's `base` field into the other transport, and `github-pr-listing.corpus.test.ts` holds the two in agreement. The per-base asks of the *Base readings* slice go through `Build.runsForSha`, so they move with that plan and need no change of their own.
- `refs-from-files` and `one-cat-file-batch` change the local refs readers. `remoteSha` is a `git ls-remote` against `origin` and stays in `refs-remote-git.ts`, which neither plan names.

### Approach

**Decided 2026-11-09, jwloka.** These four points are settled and the slices build them:

1. A pull request into a non-default base (a `sprint/**` branch) is held by that base's own settled CI reading. fleetd keeps one reading per held base, as it does for `main` today, with the same writer (`refreshDefaultBranch`), the same schema (`DefaultBranchReadingSchema`) and the same staleness rule (`defaultBranchRed`).
2. A base with no reading holds nothing.
3. A pull request into the default branch keeps today's hold, unchanged.
4. The repair exception (`repairPr`/`revertPr` in `.plot/state/repair-record.json`, read by `repairMergeVerdict` in `merge` and `mergeArm`) is unchanged. The repair record is about the default branch only; a red base opens no record.

**Which bases get a reading: every `sprint/*` branch on `origin`.** The beat reads them from `git ls-remote origin refs/heads/<default> 'refs/heads/sprint/*'`, one call that also answers the default branch's tip. Two other sources were rejected:

- The sprint files. A sprint file may exist only on its own sprint branch: on 2026-11-09 `docs/sprints/active/` on `origin/main` (`4d03a42f6`) lists only `ship-2-32-0.md`, and `desk-probes-and-liveness.md` exists only on `sprint/desk-probes-and-liveness`. A reading from the default branch's sprint index misses the branch that needs it.
- The bases of open pull requests. These need the PR index's `base` field (slice *Index base*), a read of the index in the beat, and a reading for every stacked feature base, none of which runs CI on push.

`localChecksBase` (`packages/domain/src/rules/local-checks-base.ts:24-31`) already names a sprint's integration branch `sprint/<slug>`; this plan reads the same convention from refs.

**What a sprint base's reading reads.** `ci.yml` runs `pull_request` into `main` and `sprint/**` and `push` into `main` only (`.github/workflows/ci.yml:3-7`). `runsForSha(branch, sha)` lists `gh run list --branch <branch>` (`plot-host.sh:5126`), which matches a run's head branch. A sprint branch's tip therefore has runs only from the sprint PR into `main`. With no sprint PR open, the head reads `unknown`, no commit settles, `ancestorsToAsk` asks nothing with no settled commit (`default-branch.ts:154`), and the reading holds nothing. With a sprint PR open, its runs settle the sprint tip, and a red run holds every pull request into the sprint branch.

**The file layout: one file per base, the default branch's file unchanged.** `.plot/state/default-branch.json` keeps its path, its schema (`DEFAULT_BRANCH_VERSION` 1, `.strict()`) and its one writer, so every reader in the table above reads it as today. A base's reading goes to `.plot/state/base-branches/<base>.json`, for example `.plot/state/base-branches/sprint/desk-probes-and-liveness.json`, in the same schema. `baseBranchFile(repoRoot, base)` in `packages/domain/src/adapters/default-branch/` returns a `DefaultBranchStore` (`ports/default-branch.ts:11`) over that file, so `refreshDefaultBranch` writes it unchanged. A file whose `branch` field is not the asked base reads as no reading, and a base name with an empty or `..` segment reads as no reading and is never written. One file per base keeps each write a whole-file rename with no read-fold-write across bases, as `default-branch-file.ts:37-47` does today; a keyed file would make two bases' refreshes race on one file.

**The writer.** The beat at `registryd-main.ts:3088-3095` reads the default branch and the `sprint/*` tips with the one `ls-remote` above, refreshes the default branch as today, and then refreshes each sprint base through `refreshDefaultBranch` with a world whose `branch` is the base, whose `store` is `baseBranchFile`, whose `remoteSha` answers from the same listing, and which has no `repair` store. `DefaultBranchWorld.repair` becomes optional; a world with none writes no repair record. The beat deletes the file of a base that the listing no longer names. The bases are refreshed one after another inside the existing beat, each ask through the same host slot (`withHostSlot`), so a sprint base never asks concurrently with the default branch.

**The staleness rule: `Checks wait`, as for the default branch.** `defaultBranchRed(reading, now, checksWaitMs)` (`default-branch.ts:281-288`) holds only a settled-red reading whose `askedAt` is within `Checks wait` (3600 s in this repository's config). fleetd re-asks an unchanged head at least once per half `Checks wait` (`reaskIntervalMs`, `default-branch-refresh.ts:45`), so a red sprint stays held while fleetd runs, and the hold ends `Checks wait` after fleetd stops.

**The hold.** One rule in `packages/domain/src/rules/default-branch.ts` decides which reading a pull request's hold reads:

```ts
export const baseHold = (
  base: string,
  defaultBranch: string,
  baseReading: DefaultBranchReading | null,
  now: number,
  checksWaitMs: number,
): 'default' | 'base-branch-red' | null
```

It answers `default` where `base` is the default branch or `''` (a host that named no base keeps today's hold), `base-branch-red` where `defaultBranchRed(baseReading, now, checksWaitMs)` holds and `baseReading.branch` is `base`, and `null` otherwise. `default` sends the caller through today's default-branch holds unchanged. `null` applies none of them: not `default-branch-unread`, `-stale`, `-red`, `-unsettled` or `merge-in-flight`, and not fleetd's `requireReading`.

- `merge` (`merge.ts:213`) gains `defaultBranchName` and `baseReading` in `MergeReadings` and calls `baseHold` with `pr.base` after the review check. A failed read of the base's file refuses `unaskable`, as a failed read of the default branch's file does at `:253-254`. `base-branch-red` joins `MergeRefusal`, and its detail names the base and the settled SHA: `sprint/x is red on 5d82dc3. A merge now stacks a change on an unproven base.`
- `mergeAt` (`merge.ts:396`) asks `prState` first, because only the host's answer names the base. Where `pr.base` is the default branch, it reads the default branch's reading and tip and runs today's pre-check before `prReview`. Otherwise it reads the base's file and no tip. The cost is one `prState` call on a refusal that today costs none, only while the default branch's tip is ahead of its settled reading. The *Master Agent* paragraph in `CLAUDE.md` changes from "with no `prState` and no `prReview` call" to "with no `prReview` call".
- `mergeArm` (`slice-pr-next.ts:354`) reads `row.base` and calls `baseHold`; `SlicePrNextReadings` gains `baseReading` and `defaultBranchName`. A row with no `base` reads as the default branch. `base-branch-red` joins the hold union at `:116`. `auto-merge.ts` reads one base file per distinct non-default base among the open rows: a file read, no process.
- The repair exception stays inside the `default` path in both `merge` and `mergeArm`, so its rows do not change.

**Readers that stay on the default branch.** The queue's hold (`whyNotReady`, `queue.ts:584`) is about the branch a slice is cut from, and dispatch cuts every slice from `origin/<default>` (`plot-dispatch.sh:2438`), so it stays. The IndexMonitor's `default branch red` finding and the board's `defaultBranchStatus` line report the default branch and stay. A red sprint base shows as the `base-branch-red` refusal or hold on the pull request that meets it.

**The PR index carries the base.** `PrIndexRowSchema` gains `base: z.string().optional()`, filled from `baseRefName` on GitHub and `destination.branch.name` on Bitbucket in the four `pr-list` arms. The row schema is `.strict()`, so `PR_INDEX_VERSION` goes from 6 to 7 (`pr-index.ts:12`). A v6 store then decodes as another version and every consumer asks the host, as *A Decision Reads The Index* requires; the first PR beat after the upgrade does one full read and writes a v7 store.

**The cost, per beat and per base.**

| Read | Today | After |
|---|---|---|
| Tips | 1 `git ls-remote` for the default branch | 1 `git ls-remote` for the default branch and every `sprint/*` branch |
| Runs of the default branch | 1 `runsForSha` when due, up to 1 + `ANCESTOR_ASKS_MAX` (5) | unchanged |
| Runs of one sprint base | none | 1 `runsForSha` when due, up to 1 + 5 when the base has a settled commit and an unconcluded head |
| Base files | none | 1 file read per distinct non-default base in `mergeAt` and the merge pass; no process |
| Index | the `pr-list` calls of the PR beat | the same calls, one more field |

"When due" is the re-ask rule of `refreshDefaultBranch`: every `REASK_MS` (5 min) inside `Checks wait` from `headSince`, then once per half `Checks wait` (1800 s). Each ask is one `plot-host.sh runs-for-sha` call, which is one `gh run list` request through the host slot. On `sprint/desk-probes-and-liveness` today (no sprint PR open, head `unknown`, no settled commit) that is 12 asks in the first hour after each new tip and 2 per hour after it, and no walk. `git ls-remote`, the walk's `firstParentLine` and the file reads ask no host API. A walk over a tip that is not fetched locally reads no line and asks nothing.

**The census.** S4 (an idle fleetd pass) runs on fixtures whose `origin` holds no `sprint/*` branch (`packages/fleet/test/census/sandbox.ts`), so the one combined `ls-remote` replaces the default branch's own, and S4 does not move. Two things hold that. The census gate (`census-gate.mjs`) compares S4 on the *Base readings* PR with its merge base under the row's tolerance. A unit row in `default-branch-refresh.test.ts` asserts that a beat with no `sprint/*` branch on `origin` makes one tip listing and no `runsForSha` call beyond the default branch's, and that a beat with one sprint base adds at most one `runsForSha` call when the base is due and none when it is not. The default branch's re-ask appears in no S4, S5 or S6 sample today (`github-reads-in-process`, *Status*), and a sprint base's re-ask runs at the same cadence.

### Open Questions

- [ ] **The other merge holds on a sprint base.** With a sprint reading present, `baseHold` applies only the red hold, with `defaultBranchRed`'s staleness (an old reading holds nothing). The default branch's merge controller also refuses `default-branch-stale`, `default-branch-unsettled` and `merge-in-flight`. On a sprint base, `merge-in-flight` would hold every slice merge until the sprint PR's run on the previous merge settles, about 25 minutes per run (`sprint-prs-run-ci`, *Motivation*), and the sprint PR into `main` keeps every default-branch hold. Recommendation: apply only the red hold on a sprint base in this plan. A person decides.
- [ ] **Lifting a red sprint base.** `base-branch-red` also holds the pull request that fixes the sprint branch, and the repair exception covers only the default branch. Recommendation: no repair arm for a sprint base in this plan. A person pushes the fix to the sprint branch or merges it on GitHub, and the sprint PR's next green run lifts the hold. A person decides.

## Done when

| Claim | Check | Slice |
|---|---|---|
| The index records each PR's base | `pr-index.test.ts`: a row with `base` round-trips, and a v6 store decodes as another version; `PR_INDEX_VERSION` is 7 | Index base |
| Every listing arm emits the base | the `pr-list` contract rows in `test/reconcile/host.test.mjs`: a GitHub `--rich`, `--rich-open` and plain row and a Bitbucket row each carry `base` from the fixture's base branch | Index base |
| A PR into a sprint branch is not held by a red `main` with no sprint reading | a `merge` row: PR into `sprint/x`, `main` settled red and fresh, no reading for `sprint/x`, every other check passing, merges and is not refused `default-branch-red` | Base hold |
| fleetd's merge arm agrees | a `slicePrNext` row: an open row with `base: 'sprint/x'`, `main` settled red, no `sprint/x` reading, review `success` on the head, selects `merge` | Base hold |
| A PR into `main` with `main` red is still held | a `merge` row and a `slicePrNext` row: PR into `main`, `main` settled red and fresh, not named by the repair record, refuses or holds `default-branch-red` | Base hold |
| The repair exception is unchanged | every existing repair row in `merge.test.ts` and `slice-pr-next.test.ts` passes unchanged | Base hold |
| A red sprint base holds its own PRs | a `merge` row and a `slicePrNext` row: PR into `sprint/x` with a fresh settled-red `sprint/x` reading refuses or holds `base-branch-red`, and the detail names `sprint/x`; the same reading older than `Checks wait` holds nothing | Base hold |
| `mergeAt` reads the base before the pre-check | a `mergeAt` row: PR into `sprint/x` while `main`'s tip is ahead of its settled reading is not refused `default-branch-unsettled`; PR into `main` in the same state is refused with one `prState` call and no `prReview` call | Base hold |
| A row with no base keeps today's hold | a `slicePrNext` row: a row with no `base` and `main` red holds `default-branch-red` | Base hold |
| The queue's hold is unchanged | every existing `whyNotReady` row passes unchanged | Base hold |
| fleetd writes one reading per sprint base | a `default-branch-refresh.test.ts` row: a world for `sprint/x` writes `.plot/state/base-branches/sprint/x.json` with `branch: 'sprint/x'`, and a red reading writes no repair record | Base readings |
| A base file is guarded | a `baseBranchFile` row: a file whose `branch` names another base, and a base with a `..` segment, read as no reading | Base readings |
| One tip listing serves every base | a beat row: with no `sprint/*` branch, one listing and no added `runsForSha`; with one due sprint base, one added `runsForSha`; the file of a base the listing no longer names is deleted | Base readings |
| S4 does not grow | the census gate on the *Base readings* PR: S4 on each fixture within its tolerance of the merge base | Base readings |

## Slices

### Index base

- `bug/red-hold-index-base` — `base` on `PrIndexRowSchema`, `PR_INDEX_VERSION` 7, the base field in the four `pr-list` arms of `plot-host.sh` and in `rules/github-pr-row.ts` where `github-reads-in-process` has merged it, and the contract and index rows <!-- builds: the PR index records each pull request's base branch -->

### Base hold

- `bug/red-hold-reads-the-pr-base` — `baseHold` in `rules/default-branch.ts`, `baseBranchFile` as a reader, `base-branch-red` in `merge`, `mergeAt` and `mergeArm`, the base reads in `auto-merge.ts`, and the `CLAUDE.md` paragraph on `mergeAt`; merges after `bug/red-hold-index-base` <!-- builds: the merge hold reads the pull request's base branch -->

### Base readings

- `bug/red-hold-base-readings` — the combined tip listing in `refs-remote-git.ts`, the optional `repair` in `DefaultBranchWorld`, the per-base refresh and the file removal in fleetd's beat, and the beat and census rows; merges after `bug/red-hold-reads-the-pr-base` <!-- builds: fleetd keeps a CI reading per sprint branch -->

## Notes

- The *Base hold* slice alone answers the issue's three *Done when* rows: with no base file written yet, every PR into a sprint branch has no base reading and is held by nothing. *Base readings* then adds the sprint's own hold.
- Decisions recorded 2026-11-09, jwloka: type `bug`; tier Should in sprint `desk-probes-and-liveness`; a non-default base is held by its own settled reading, kept per base by fleetd; a base with no reading holds nothing; a PR into the default branch keeps today's hold; the repair exception is unchanged.
- Line numbers checked in the worktree of `idea/red-hold-reads-the-pr-base`, cut from `origin/sprint/desk-probes-and-liveness` at `3497cb1f3`, on 2026-11-09. `git ls-remote origin refs/heads/main 'refs/heads/sprint/*'` answered both refs in one call on the same day.
- Deliverable search (`plot-deliverable-search.sh`) for "red hold reads the pr base" and "default branch red" found no existing deliverable.
- Definition of Done: docs/definition-of-done.md.
