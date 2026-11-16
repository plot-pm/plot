# The red hold reads the PR's base

> A pull request into the default branch is held by the default branch's settled CI reading, as today. A pull request into a `sprint/**` branch is held by that branch's own reading, which fleetd keeps beside `.plot/state/default-branch.json`, and a base with no reading holds nothing.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bug-fixes-2-35-0
- **Issue:** #3322
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3323 merged

## Changelog

- 2026-11-16: The plan is brought up to date with `5b372db9d`. `plot-ask.mjs merge` already applies the default-branch holds only to a pull request into the default branch; the plan keeps the remaining work: the index's `base`, fleetd's merge arm, the per-base reading and the per-base repair arm.
- A red `main` no longer holds a pull request into a sprint branch in fleetd's merge arm. `mergeArm` reads the pull request's base from the PR index and applies the default branch's holds only to a pull request into the default branch, as `mergeAt` does.
- A pull request into a sprint branch is refused `base-branch-red` while that branch's own settled CI reading is red. fleetd keeps one reading per `sprint/*` branch in `.plot/state/base-branches/`.
- The PR index records each pull request's base branch (`PR_INDEX_VERSION` 7).

Board impact: none on the plan format, the template, the helper scripts' interfaces or the `docs/plans` layout. The board's default-branch status line and the IndexMonitor's `default branch red` finding stay about the default branch.

## Motivation

Issue #3322 records the defect. On 2026-11-09 `main` went red on `ca37e53ba`. While it stayed red, `plot-ask.mjs merge` refused three reviewed slice PRs into `sprint/desk-probes-and-liveness` with `default-branch-red`: #3313, #3316 and #3319. Their base was the sprint branch, which forked from `main` before the red commit, so `main`'s red said nothing about them. A person merged all three on GitHub to get past the hold.

**`plot-ask.mjs merge` reads the base on `main`.** `holdsApply(base, defaultName)` (`packages/domain/src/workflows/merge.ts:200-201`) answers false only where the PR's base and the default branch's name are both known and differ. `merge` applies every default-branch hold inside `if (holdsApply(pr.base, readings.defaultBranchName))` (`merge.ts:343`), so `default-branch-red` (`:361`), `-stale`, `-unread`, `-unsettled` and the `unaskable` reading and tip refusals skip a PR into another branch. `mergeAt` (`merge.ts:518`) asks `prState` at `:528`, reads the default branch's name through `Refs.defaultBranch` at `:530-531` only where the PR names a base, and runs the moved-tip pre-check only where `holds` is true (`:532-533`), before `prReview`. `workflows-merge.test.ts:966` merges a PR into `sprint/idle-and-supersede` on a red, stale, unsettled, missing-with-`requireReading`, unread and tip-unread reading, and `:1057` does the same through `mergeAt` and reads no repair record. The three PRs of #3322 now merge through `plot-ask.mjs merge` while `main` is red.

**fleetd's merge arm still holds them.** Each reader that remains on the default branch's reading alone:

| Reader | Where | What it reads |
|---|---|---|
| fleetd's merge arm | `mergeArm`, `packages/domain/src/rules/slice-pr-next.ts:354-386` | `readings.defaultBranch` and no base; `default-branch-unread` at `:361`, `default-branch-red` at `:371` |
| fleetd's merge pass | `packages/fleet/src/shared/auto-merge.ts:215` (`slicePrNext`) and `:245` (`mergeAt`) | `defaultBranchFile` at `:298`, `requireReading: true` at `:319` |
| The queue | `whyNotReady`, `packages/domain/src/rules/queue.ts:594`, `default-branch-red` at `:600` | `defaultBranchRed` from `packages/fleet/src/server/entry/registryd-main.ts:1103-1106` |
| The IndexMonitor | `indexFindings`, `packages/domain/src/rules/index-findings.ts:167` | the `default branch red` finding |
| The board | `defaultBranchStatus`, `packages/domain/src/rules/default-branch.ts:357` | the status line |

The merge pass asks `slicePrNext` first, so `mergeArm` holds a sprint PR `default-branch-red` before `mergeAt` runs. `auto-merge.test.ts:162` proves `mergeAt`'s half only: its selection reads a green default branch and its merge-time reading is red. `CLAUDE.md`'s paragraph *One hold reads a non-terminal answer* states the same: fleetd's selection still holds every PR on the default-branch holds whatever its base.

`mergeArm` cannot read the base: `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts:30-155`, `.strict()` at `:155`) has no base field, and `storeRow` (`packages/fleet/src/shared/pr-refresh.ts:1087`) copies none. The three Bitbucket `pr-list` arms of `plot-host.sh` already emit `base:(.destination.branch.name // "")` (`:4970`, `:4976`, `:4981`). The three GitHub arms do not ask for `baseRefName` (`--json` at `:4746`, `:4791`, `:4822`), and neither do the in-process GitHub listing fragments (`packages/domain/src/adapters/host/github-pr-listing.ts:15`, `:19`) or `githubPlainRow`/`githubRichRow` (`packages/domain/src/rules/github-pr-row.ts:43`, `:82`). `prState` answers it (`Pr.base`, `packages/domain/src/entities/pr.ts:76`).

No sprint base has a reading. One writer keeps the default branch's reading: `refreshDefaultBranch` (`packages/fleet/src/shared/default-branch-refresh.ts:269`), with the world fleetd builds at `registryd-main.ts:3372-3395` (`store: defaultBranchFile(repoRoot)` at `:3389`, `repair: repairRecordFile(repoRoot)` at `:3390`). It reads the tip with `git ls-remote` (`refsRemoteGit.remoteSha`, `packages/domain/src/adapters/refs/refs-remote-git.ts:86`), asks `runsForSha`, and writes the repair record through `world.repair` (`default-branch-refresh.ts:198`, `:222`). `DefaultBranchWorld.repair` is required (`:76`). `plot-deliverable-search.sh` for `baseBranchFile`, `base-branches` and `baseHold` finds no deliverable, and `grep` for `base-branch-red` under `packages/` and `skills/plot/scripts/` finds none.

## Design

This plan has no `Story:`. It belongs to sprint `bug-fixes-2-35-0`, recorded in its `Sprint:` field.

It shares files with two plans:

- `github-reads-in-process` has merged its PR listing (`a42f4a137`) and its issues and runs reads (`e1f8731fd`). The *Index base* slice adds `baseRefName` to both transports, and `packages/domain/corpus/github-pr-listing.corpus.test.ts` holds the two in agreement. The per-base asks of the *Base readings* slice go through `Build.runsForSha`, which that plan moved, and need no change of their own.
- `refs-from-files` and `one-cat-file-batch` change the local refs readers. `remoteSha` is a `git ls-remote` against `origin` and stays in `refs-remote-git.ts`, which neither plan names.

### Approach

**Decided 2026-11-09, jwloka.** These four points are settled and the slices build them:

1. A pull request into a non-default base (a `sprint/**` branch) is held by that base's own settled CI reading. fleetd keeps one reading per held base, as it does for `main`, with the same writer (`refreshDefaultBranch`), the same schema (`DefaultBranchReadingSchema`) and the same staleness rule (`defaultBranchRed`).
2. A base with no reading holds nothing.
3. A pull request into the default branch keeps the default branch's holds, unchanged.
4. The default branch's repair exception (`repairPr`/`revertPr` in `.plot/state/repair-record.json`, read by `repairMergeVerdict` in `merge` and `mergeArm`) is unchanged.

**Decided 2026-11-10, jwloka.** Two more points:

5. A sprint base applies only the red hold. `default-branch-stale`, `default-branch-unsettled` and `merge-in-flight` stay on the default branch.
6. A red sprint base has its own repair arm. A red reading opens an episode in a per-base repair record, and the base's repair PR merges through `plot-ask.mjs merge` while every other PR into that base is held `base-branch-red`. The slice *Base repair* builds it.

Points 2, 3 and 5 hold in `merge` and `mergeAt` on `main` through `holdsApply`. The slices build them in `mergeArm` and build points 1 and 6 everywhere.

**Which bases get a reading: every `sprint/*` branch on `origin`.** The beat reads them from `git ls-remote origin refs/heads/<default> 'refs/heads/sprint/*'`, one call that also answers the default branch's tip. Two other sources were rejected:

- The sprint files. A sprint file may exist only on its own sprint branch: on 2026-11-09 `docs/sprints/active/` on `origin/main` (`4d03a42f6`) listed only `ship-2-32-0.md`, and `desk-probes-and-liveness.md` existed only on `sprint/desk-probes-and-liveness`. A reading from the default branch's sprint index misses the branch that needs it.
- The bases of open pull requests. These need the PR index's `base` field (slice *Index base*), a read of the index in the beat, and a reading for every stacked feature base, none of which runs CI on push.

`localChecksBase` (`packages/domain/src/rules/local-checks-base.ts:33`) already takes the default branch and every `sprint/*` branch on `origin` as its candidates; this plan reads the same convention from refs.

**What a sprint base's reading reads.** `ci.yml` runs `pull_request` into `main` and `sprint/**` and `push` into `main` only (`.github/workflows/ci.yml:3-7`). `runsForSha(branch, sha)` lists `gh run list --branch <branch>` (`plot-host.sh:5163`, in the `runs-for-sha` arm at `:5056`), which matches a run's head branch. A sprint branch's tip therefore has runs only from the sprint PR into `main`. With no sprint PR open, the head reads `unknown`, no commit settles, `ancestorsToAsk` asks nothing with no settled commit (`default-branch.ts:158`), and the reading holds nothing. With a sprint PR open, its runs settle the sprint tip, and a red run holds every pull request into the sprint branch.

**The file layout: one file per base, the default branch's file unchanged.** `.plot/state/default-branch.json` keeps its path, its schema (`DEFAULT_BRANCH_VERSION` 1, `.strict()`) and its one writer, so every reader in the table above reads it unchanged. A base's reading goes to `.plot/state/base-branches/<base>.json`, for example `.plot/state/base-branches/sprint/desk-probes-and-liveness.json`, in the same schema. `baseBranchFile(repoRoot, base)` in `packages/domain/src/adapters/default-branch/` returns a `DefaultBranchStore` (`packages/domain/src/ports/default-branch.ts:11`) over that file, so `refreshDefaultBranch` writes it unchanged. A file whose `branch` field is not the asked base reads as no reading, and a base name with an empty or `..` segment reads as no reading and is never written. One file per base keeps each write a whole-file rename with no read-fold-write across bases, as `defaultBranchFile` does (`default-branch-file.ts:22`, rename at `:38-43`); a keyed file would make two bases' refreshes race on one file.

**The writer.** The beat at `registryd-main.ts:3372-3395` reads the default branch and the `sprint/*` tips with the one `ls-remote` above, refreshes the default branch as now, and then refreshes each sprint base through `refreshDefaultBranch` with a world whose `branch` is the base, whose `store` is `baseBranchFile`, whose `remoteSha` answers from the same listing, and whose `repair` store is the base's own record (slice *Base repair*; until it merges, the world has none). `DefaultBranchWorld.repair` (`default-branch-refresh.ts:76`) becomes optional; a world with none writes no repair record. The beat deletes the file of a base that the listing no longer names. The bases are refreshed one after another inside the existing beat, each ask through the same `slot` (`withHostSlot`, `registryd-main.ts:3393-3395`), so a sprint base never asks concurrently with the default branch.

**The staleness rule: `Checks wait`, as for the default branch.** `defaultBranchRed(reading, now, checksWaitMs)` (`default-branch.ts:281`) holds only a settled-red reading whose `askedAt` is within `Checks wait` (3600 s in this repository's config). fleetd re-asks an unchanged head at least once per half `Checks wait` (`reaskIntervalMs`, `default-branch-refresh.ts:45`), so a red sprint stays held while fleetd runs, and the hold ends `Checks wait` after fleetd stops.

**The hold.** `holdsApply` (`merge.ts:200`) already decides between the two paths in `merge` and `mergeAt`: true sends a PR through the default branch's holds, false skips them all. One rule in `packages/domain/src/rules/default-branch.ts` decides the false path:

```ts
export const baseBranchRed = (
  base: string,
  baseReading: DefaultBranchReading | null,
  now: number,
  checksWaitMs: number,
): boolean
```

It answers true where `defaultBranchRed(baseReading, now, checksWaitMs)` holds and `baseReading.branch` is `base`, and false otherwise. It applies nothing else: not `-unread`, `-stale`, `-unsettled`, `merge-in-flight` or fleetd's `requireReading`.

- `merge` (`merge.ts:281`) gains `baseReading` in `MergeReadings` and, where `holdsApply` answers false, calls `baseBranchRed` with `pr.base`. A failed read of the base's file refuses `unaskable`, as a failed read of the default branch's file does inside the `holdsApply` block. `base-branch-red` joins `MergeRefusal` (`merge.ts:34`), and its detail names the base and the settled SHA: `sprint/x is red on 5d82dc3. A merge now stacks a change on an unproven base.`
- `mergeAt` (`merge.ts:518`) reads the base's file after `prState` (`:528`) where `holds` (`:532`) is false, and no tip.
- `mergeArm` (`slice-pr-next.ts:354`) reads `row.base` and the default branch's name, and calls `holdsApply` before its default-branch holds at `:361-380`; where it answers false, it calls `baseBranchRed`. `SlicePrNextReadings` (`slice-pr-next.ts:63`) gains `baseReading` and `defaultBranchName`. A row with no `base` reads as `''`, which `holdsApply` keeps on the default branch. `base-branch-red` joins the hold union at `:116`. `auto-merge.ts` reads one base file per distinct non-default base among the open rows: a file read, no process.
- The repair exception stays inside the `holdsApply` path in `merge` and `mergeArm`, so its rows do not change.

**Readers that stay on the default branch.** The queue's hold (`whyNotReady`, `queue.ts:594`) is about the branch a slice is cut from and is out of scope. The IndexMonitor's `default branch red` finding and the board's `defaultBranchStatus` line report the default branch and stay. A red sprint base shows as the `base-branch-red` refusal or hold on the pull request that meets it.

**The PR index carries the base.** `PrIndexRowSchema` gains `base: z.string().optional()`, filled from `baseRefName` on GitHub (the three shell arms and the in-process listing fragments) and from the `base` the Bitbucket arms already emit; `storeRow` copies a non-empty `base`. The row schema is `.strict()`, so `PR_INDEX_VERSION` goes from 6 to 7 (`pr-index.ts:12`). A v6 store then decodes as another version and every consumer asks the host, as *A Decision Reads The Index* requires; the first PR beat after the upgrade does one full read and writes a v7 store.

**The cost, per beat and per base.**

| Read | Now | After |
|---|---|---|
| Tips | 1 `git ls-remote` for the default branch | 1 `git ls-remote` for the default branch and every `sprint/*` branch |
| Runs of the default branch | 1 `runsForSha` when due, up to 1 + `ANCESTOR_ASKS_MAX` (5, `default-branch.ts:118`) | unchanged |
| Runs of one sprint base | none | 1 `runsForSha` when due, up to 1 + 5 when the base has a settled commit and an unconcluded head |
| Base files | none | 1 file read per distinct non-default base in `mergeAt` and the merge pass; no process |
| Index | the `pr-list` calls of the PR beat | the same calls, one more field |

"When due" is the re-ask rule of `refreshDefaultBranch`: every `REASK_MS` (5 min, `default-branch-refresh.ts:29`) inside `Checks wait` from `headSince`, then once per half `Checks wait` (1800 s). Each ask is one `runsForSha` request through the host slot. On a sprint branch with no sprint PR open (head `unknown`, no settled commit) that is 12 asks in the first hour after each new tip and 2 per hour after it, and no walk. `git ls-remote`, the walk's `firstParentLine` and the file reads ask no host API. A walk over a tip that is not fetched locally reads no line and asks nothing.

**The census.** S4 (an idle fleetd pass) runs on fixtures whose `origin` holds no `sprint/*` branch (`packages/fleet/test/census/sandbox.ts`), so the one combined `ls-remote` replaces the default branch's own, and S4 does not move. Two things hold that. The census gate (`packages/fleet/test/census/census-gate.mjs`) compares S4 on the *Base readings* PR with its merge base under the row's tolerance. A unit row in `default-branch-refresh.test.ts` asserts that a beat with no `sprint/*` branch on `origin` makes one tip listing and no `runsForSha` call beyond the default branch's, and that a beat with one sprint base adds at most one `runsForSha` call when the base is due and none when it is not.

**The repair arm on a sprint base.** A base's repair record lives at `.plot/state/base-branches/<base>.repair.json` in the schema of `.plot/state/repair-record.json`, with `branch` set to the base. `refreshDefaultBranch` writes it through the world's `repair` store, as it writes the default branch's record, so a red sprint reading opens an episode with that base's `lastGreenSha` and a green reading closes it. `plot-ask.mjs repair-pr <pr>` reads the PR's base: a PR into a sprint base is recorded on that base's record, and its head must be `bug/sprint-repair-<12 hex of the base's lastGreenSha>`. Its refusals are the default branch's, with the same names. `merge` and `mergeArm` admit that one PR on `base-branch-red` under the conditions `repairMergeVerdict` checks for the default branch: the episode is open, the head branch matches, and the base's runs, asked again immediately before the merge, still read red. Every other PR into the base refuses `base-branch-red`. A base with no reading opens no record. The beat deletes a base's record with its reading file when the listing no longer names the base.

### Open Questions

- [x] **The other merge holds on a sprint base.** Decided 2026-11-10, jwloka: only the red hold (Approach, point 5).
- [x] **Lifting a red sprint base.** Decided 2026-11-10, jwloka: a repair arm per sprint base (Approach, point 6; slice *Base repair*).

## Done when

Rows already met on `main` by `5b372db9d`:

| Claim | Evidence |
|---|---|
| `plot-ask.mjs merge` does not hold a PR into a sprint branch on a red `main` with no sprint reading | `packages/domain/test/workflows-merge.test.ts:966` (`merge`, six default-branch holds) and `:1057` (`mergeAt`, no repair record read) |
| A PR into `main` with `main` red is still refused by `merge` | `workflows-merge.test.ts:970`, `:1065`; `packages/fleet/test/unit/auto-merge.test.ts:155` |
| `mergeAt` reads the base before the pre-check | `workflows-merge.test.ts:1071`: a default-branch PR refuses `default-branch-unsettled` after one `prState` call and no `prReview` call; `:966` covers a sprint PR on an unsettled reading |
| An empty base or an unread default-branch name keeps the holds in `merge` | `workflows-merge.test.ts:974`, `:1078` |
| The repair exception is unchanged in `merge` | `workflows-merge.test.ts:992` |
| The `CLAUDE.md` paragraph on `mergeAt` names one `prState` call | `CLAUDE.md`, paragraph *One hold reads a non-terminal answer*: "after that one `prState` call and with no `prReview` call" |

Rows still to meet:

| Claim | Check | Slice |
|---|---|---|
| The index records each PR's base | `pr-index.test.ts`: a row with `base` round-trips, and a v6 store decodes as another version; `PR_INDEX_VERSION` is 7 | Index base |
| Every listing arm emits the base | the `pr-list` contract rows in `test/reconcile/host.test.mjs`: a GitHub `--rich`, `--rich-open` and plain row and a Bitbucket row each carry `base` from the fixture's base branch; `github-pr-listing.corpus.test.ts` agrees for the in-process read | Index base |
| fleetd's merge arm does not hold a PR into a sprint branch on a red `main` | a `slicePrNext` row: an open row with `base: 'sprint/x'`, `main` settled red, no `sprint/x` reading, review `success` on the head, selects `merge` | Base hold |
| fleetd's merge arm still holds a PR into `main` | a `slicePrNext` row: PR into `main`, `main` settled red and fresh, not named by the repair record, holds `default-branch-red` | Base hold |
| A row with no base keeps the default branch's hold | a `slicePrNext` row: a row with no `base` and `main` red holds `default-branch-red` | Base hold |
| The repair exception is unchanged in `mergeArm` | every existing repair row in `slice-pr-next.test.ts` passes unchanged | Base hold |
| A red sprint base holds its own PRs | a `merge` row and a `slicePrNext` row: PR into `sprint/x` with a fresh settled-red `sprint/x` reading refuses or holds `base-branch-red`, and the detail names `sprint/x`; the same reading older than `Checks wait` holds nothing | Base hold |
| The queue's hold is unchanged | every existing `whyNotReady` row passes unchanged | Base hold |
| fleetd writes one reading per sprint base | a `default-branch-refresh.test.ts` row: a world for `sprint/x` writes `.plot/state/base-branches/sprint/x.json` with `branch: 'sprint/x'`, and a red reading with no `repair` store writes no repair record | Base readings |
| A base file is guarded | a `baseBranchFile` row: a file whose `branch` names another base, and a base with a `..` segment, read as no reading | Base readings |
| One tip listing serves every base | a beat row: with no `sprint/*` branch, one listing and no added `runsForSha`; with one due sprint base, one added `runsForSha`; the file of a base the listing no longer names is deleted | Base readings |
| S4 does not grow | the census gate on the *Base readings* PR: S4 on each fixture within its tolerance of the merge base | Base readings |
| A red sprint base opens its own episode | a `default-branch-refresh.test.ts` row: a red `sprint/x` reading writes `.plot/state/base-branches/sprint/x.repair.json` with that base's `lastGreenSha`, a green reading closes it, and `.plot/state/repair-record.json` does not change | Base repair |
| The base's repair PR merges | a `merge` row and a `slicePrNext` row: PR into `sprint/x` named as `repairPr` on the base's open record, head `bug/sprint-repair-<12 hex>`, runs still red, merges or selects `merge`; another PR into `sprint/x` refuses or holds `base-branch-red` | Base repair |
| `repair-pr` records on the PR's base | a `plot-ask.mjs repair-pr` row: a PR into `sprint/x` is recorded on the base's record; a head that does not match, no open episode and a second repair PR refuse by the default branch's names | Base repair |

## Slices

### Index base

- `bug/red-hold-index-base` — `base` on `PrIndexRowSchema` and in `storeRow`, `PR_INDEX_VERSION` 7, `baseRefName` in the three GitHub `pr-list` arms of `plot-host.sh`, in the in-process listing fragments of `github-pr-listing.ts` and in `rules/github-pr-row.ts`, and the contract, corpus and index rows; the Bitbucket arms already emit `base` <!-- builds: the PR index records each pull request's base branch -->

### Base hold

- `bug/red-hold-reads-the-pr-base` — `holdsApply` over `row.base` in `mergeArm`, `baseBranchRed` in `rules/default-branch.ts`, `baseBranchFile` as a reader, `base-branch-red` in `merge`, `mergeAt` and `mergeArm`, the base reads in `auto-merge.ts`, and the `CLAUDE.md` sentence on fleetd's selection; merges after `bug/red-hold-index-base` <!-- builds: fleetd's merge arm reads the pull request's base branch -->

### Base readings

- `bug/red-hold-base-readings` — the combined tip listing in `refs-remote-git.ts`, the optional `repair` in `DefaultBranchWorld`, the per-base refresh and the file removal in fleetd's beat, and the beat and census rows; merges after `bug/red-hold-reads-the-pr-base` <!-- builds: fleetd keeps a CI reading per sprint branch -->

### Base repair

- `bug/red-hold-base-repair` — the per-base repair store, the `repair` world for each sprint base in fleetd's beat, the base-aware `plot-ask.mjs repair-pr`, the `base-branch-red` repair arm in `merge` and `mergeArm`, and the `CLAUDE.md` paragraph on the repair exception; merges after `bug/red-hold-base-readings` <!-- builds: a red sprint base admits its own repair PR -->

## Notes

- `5b372db9d` (2026-11-15) answers the issue's `plot-ask.mjs merge` half. The *Base hold* slice answers fleetd's half: with no base file written yet, every PR into a sprint branch has no base reading and fleetd's merge arm holds it by nothing. *Base readings* then adds the sprint's own hold.
- Decisions recorded 2026-11-09, jwloka: type `bug`; a non-default base is held by its own settled reading, kept per base by fleetd; a base with no reading holds nothing; a PR into the default branch keeps the default branch's hold; the default branch's repair exception is unchanged.
- Decisions recorded 2026-11-10, jwloka: a sprint base applies only the red hold; a red sprint base has its own repair arm, built as the fourth slice.
- Line numbers checked on `main` at `0ebe1bb88` on 2026-11-16.
- Deliverable search (`plot-deliverable-search.sh`) for "red hold reads the pr base", "base branch red", "baseHold", "baseBranchFile", "base-branches", "sprint repair" and "index base" found no existing deliverable.
- Definition of Done: docs/definition-of-done.md.
