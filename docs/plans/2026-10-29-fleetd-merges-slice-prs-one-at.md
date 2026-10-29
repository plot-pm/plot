# fleetd merges slice PRs one at a time

> fleetd merges a slice PR whose `plot/review` status is `success` on the current head, one merge at a time, and holds while the default branch is red, stale, unread or unsettled.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2902
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- fleetd merges a slice PR of the active sprint when `plot/review` is `success` on its head. It merges one PR at a time and waits for the default branch's CI to settle on the new head between merges, whoever made the last merge.
- `plot-ask.mjs merge` refuses a PR whose `plot/review` status is not `success` on the pinned head (`review-not-passed`), and refuses while the default branch's tip is not the settled head of its CI reading (`default-branch-unsettled`).
- On GitHub, fleetd merges nothing until the repository declares `Merger app`, so every fleet merge runs as the App under the ruleset.

<!-- Board impact: none. The plan format, the template and docs/plans are unchanged. `mergeAt` moves from packages/board into packages/domain, and `plot-ask.mjs merge` keeps its arguments and output. A board artifact rebuild follows from the moved import. -->

## Motivation

fleetd merges nothing today. A master agent runs `plot-ask.mjs merge` for every slice PR, so delivery stops when that session ends. `mergeAt` has one caller, the `merge` arm of `plot-ask.mjs` (`packages/board/src/server/entry/main.ts:151-176`). [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka on 2026-10-29) moves the merge into fleetd as a domain rule. Its anti-goal is a default branch that goes red and stays red, and one merge in flight is its main guard.

Panel round 1 executed probes against `merge()` and `defaultBranchRed()` and measured four gaps in the controller this plan builds on:

1. **`merge()` does not enforce one merge in flight.** `merge()` (`packages/domain/src/workflows/merge.ts:95-136`) checks only a stale and a red reading (`:121-128`) and never compares the reading's head with its settled commit. Four jurors saw it decide to merge on a head that is `pending` past a green settled commit, on a reading that still names the pre-merge head, and on no reading at all (`:121`, a `null` reading holds nothing). The layering juror read the first case live on this machine: head `5163dbee` pending, settled `88ab8e4b`.
2. **The reading lags fleetd's own merge.** fleetd writes `.plot/state/default-branch.json` on the PR beat, every twelfth 5 s beat (`packages/fleet/src/shared/fleet-clock.ts:28-35`, `registryd-main.ts:2615`). The automatic writes, where a merge runs, run on every scan beat (`registryd-main.ts:2598`). About eleven scans after a merge still read the old head as settled green, so a reading-only mark answers *merge* for the next PR.
3. **`default-branch-red` is the dispatch hold, not the merge hold.** `whyNotReady` returns it to hold a queued slice (`packages/domain/src/rules/queue.ts:583`). `defaultBranchRed` reads a stale red as not red and lifts the hold (`packages/domain/src/rules/default-branch.ts:262-270`). The merge controller refuses any stale reading as `default-branch-stale` (`merge.ts:121-126`). The two answer differently on one reading, so the merge arm needs its own stale arm.
4. **The controller does not check the review, and the fleet would merge with bypass rights.** `merge()` reads the checks rollup only (`merge.ts:111-116`). An absent `plot/review` status is missing from the rollup, which can still fold green. Ruleset 24412719 gives the Admin role `bypass_mode: always`, the signed-in `gh` identity is admin, and this repository declares no `Merger app`, so `plot-host.sh pr-merge` merges as that identity (`skills/plot/scripts/plot-host.sh:4441-4453`). `docs/review-status-rollout.md:153`: "Declare `Merger app` to close it."

Two claims of the first draft were wrong. The merge path has no unattended refusal: `MergeRefusal` has none (`merge.ts:11-19`), and `mergeAt` and the `merge` arm of `plot-ask.mjs` read no `PLOT_UNATTENDED`. #2898 adds that refusal (D1). And #2900 builds no caller identity; this plan needs #2900's `slicePrNext` rule file, its review record in the PR index, its scope reader and its tick wiring.

`mergeAt` lives in `packages/board/src/server/entry/merge.ts:48-75`, and `@plot-pm/fleet` depends only on `@plot-pm/domain` and `zod` (`packages/fleet/package.json:28-31`). fleetd cannot call the merge without a cross-package dependency or a new spawn site, so this plan moves `mergeAt` into the domain.

Siblings this plan depends on or hands work to: #2898 (caller reading and the unattended refusals), #2899 (run log and idle-slice rule), #2900 (review record, scope reader, `slicePrNext`), #2903 (ticketed HIGH), #2904 (repair PR exception), #2905 (merged-slice progress), #2907 (release PR).

## Design

### Approach

The design's sections *The loop*, *One merge in flight* and *Stalls* bind this plan, as corrected by the decisions below. The plan builds the merge arm and the controller guards only. The reviewer, fixer and unblocker arms belong to other plans of the story.

**Slice 1 — the controller confirms a settled main and a passed review.**

- `mergeAt` moves into `packages/domain` as a workflow over the `Host`, `Scripts`, `DefaultBranchStore` and `Refs` ports. `plot-ask.mjs merge` and fleetd call the same function. No new spawn site appears outside `adapters/`; the write still goes through `scripts.hostSaid`.
- `MergeReadings` gains `defaultBranchTip`, read fresh through `Refs.remoteSha` (`packages/domain/src/ports/refs.ts:786`, `git ls-remote` in `adapters/refs/refs-remote-git.ts:54-66`). It costs no host API budget. `merge()` refuses `default-branch-unsettled` unless the tip equals the reading's `headSha` and the reading's `settled.sha` equals that tip. A tip read that fails refuses as `unaskable`. This check also catches a merge by a person, a direct push, the changesets bot and an auto-merge, because every merge path moves the tip.
- `MergeReadings` gains `review`, re-asked through `Host.prReview` (`packages/domain/src/ports/host.ts:408`). `merge()` refuses `review-not-passed` unless `plot/review` is `success` on the pinned head. `absent`, `failure`, `pending` and a failed read refuse; a failed read is never a pass.
- `MergeInput` gains `requireReading`. With it set, a `null` default-branch reading refuses as `default-branch-unread`. fleetd sets it. A person's `plot-ask.mjs merge` keeps today's rule that a missing reading holds nothing (`merge.ts:121`), because `decodeDefaultBranch` also answers `null` for a version it does not know (`packages/domain/src/entities/default-branch.ts:85-95`).

**Slice 2 — fleetd merges one PR per pass.**

- The merge arm of `slicePrNext` (`rules/slice-pr-next.ts`, created by #2900) is step 8 of #2900's composition order, so it answers only when no earlier arm answered. It reads three fields of #2900's input record: `row`, `defaultBranch` and `newestMerged`. It answers `{ step: 'merge', head }`, pinned to the head, when `row.plotReview` is `success` and `row.plotReviewSha` equals `row.headSha`. A clean review and a ticketed HIGH (#2903's `write-status` step with `ticket-accepted`) both write `success`, so both merge through this one row. A row with no `plotReview` field (not asked) answers `none`, because the index never says no.
- Each hold is #2900's `{ step: 'hold', reason }` with a reason from #2900's set. The holds gate only the merge step, so reviews and fixes continue while main is red:

| Reading | Next step |
|---|---|
| `row.plotReview` is `success` and `row.plotReviewSha` equals `row.headSha` | `merge`, pinned to the head |
| `defaultBranch` settled red within `Checks wait` | hold `default-branch-red` |
| `defaultBranch` older than `Checks wait`, red or green | hold `default-branch-stale` |
| `defaultBranch` is `null` | hold `default-branch-unread` |
| `defaultBranch.settled.sha` differs from its `headSha`, or `newestMerged.mergedAt` is later than `defaultBranch.askedAt` | hold `merge-in-flight` |
| `row.mergeable` is `CONFLICTING` | hold `conflicting` |

- The stale row reads the reading's age as `merge()` does. It never calls `defaultBranchRed`, which lifts on a stale reading. A test asserts both answers on one fixture.
- The in-flight row reads `defaultBranch` and `newestMerged`, the newest MERGED row of the PR index that the tick passes in #2900's input record. A MERGED row is terminal, so the rule reads it within *A Decision Reads The Index*. The controller's fresh tip read confirms the mark at the destructive step.
- **At most one merge per pass.** A scope-level rule (`nextMerge`) picks one candidate from the rows that answer `merge`: the lowest PR number. The tick calls `mergeAt` for that PR only, and the next pass sees the new tip.
- **The index selects, the controller re-asks.** The tick calls the domain `mergeAt` in process. A refusal ends that action. A `head-moved` refusal waits for the new head's review.
- **No retry at the same head.** fleetd keeps, in memory, the PR and head of each `host-refused` merge and does not ask again until the head moves. A fleetd restart asks once more.
- **The looping daemon only.** The merge runs in the automatic writes of the scan clock (`registryd-main.ts:2598`). `--once` merges nothing, as `skills/plot-fleet/SKILL.md:285` promises.
- **D4.** On GitHub, the merge arm answers hold `merger-app-missing`, a reason this plan adds to #2900's open reason set, and fleetd merges nothing while `Merger app` is not declared. On Bitbucket the key does not apply.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-fleetd-merges-slice-prs-one-at/panel.md`):

- [x] D1: `plot-ask.mjs merge` refuses every unattended caller, and fleetd calls `merge` in process with its typed `caller` reading. #2898 builds the refusal and the reading (`feature/unattended-callers-are-refused`); this plan adds none. The draft's claim that the merge path already refused an unattended caller was wrong.
- [x] D2: every HIGH goes to a fixer, two attempts per PR, then the ticket. This plan merges only on `plot/review` = `success` on the head; it never routes a HIGH.
- [x] D3: the scope is the active sprint file read from git at its latest commit. fleetd merges only open slice PRs of that scope, through #2900's scope reader.
- [x] D4: fleetd refuses to merge on GitHub unless `Merger app` is declared, so no fleet merge uses the admin bypass. Slice 2 builds the refusal.
- [x] D7: fleetd never merges the release PR and never runs the release finish. #2907 makes the generic merge refuse the release PR (`feature/the-release-is-approved-once`).
- [x] The merge predicate is "`plot/review` is `success` on this head", re-asked by the controller (`review-not-passed`).
- [x] The in-flight guard is a controller refusal, `default-branch-unsettled`, from a fresh `Refs.remoteSha` read, plus a rule hold from the reading and the newest MERGED `mergedAt`; at most one merge per pass.
- [x] A missing default-branch reading holds an unattended merge.
- [x] `mergeAt` moves into the domain in slice 1.
- [x] The merge arm extends #2900's `slicePrNext` and reads #2900's review record from the PR index; it waits on `feature/fleetd-reviews-slice-prs`.
- [x] The merge arm uses #2900's names (decisions map, #2900's interface names): it reads `plotReview` and `plotReviewSha` from `row` and `newestMerged` and `defaultBranch` from `slicePrNext`'s input record, and answers #2900's `merge` and `hold` steps with #2900's hold reasons, plus `merger-app-missing`.
- [x] "Settled" uses the `Default branch checks` list: the reading folds only declared runs (`declaredRuns` at `packages/fleet/src/shared/default-branch-refresh.ts:114`), and no second list exists.
- [x] A person's merge reaches the mark through the default branch's tip, read fresh at the controller; the MERGED row closes the window between fleetd's own merge and the next refresh.

### Open Questions

- [ ] A head with no declared run reads `unknown` and never settles (`foldRuns`, `packages/domain/src/rules/default-branch.ts:78-84`), so `merge-in-flight` never lifts until another push. What bound applies before fleetd notifies the person, and does the bound reuse `Checks wait`?
- [ ] Every merge on this repository is followed by a second commit on main from `build-bundles.yml`, pushed by the App, which starts CI again. Does the next merge wait for that commit to settle too? If it does, the design's 100 minutes for ten slices doubles.

### Owned elsewhere

- The unattended refusal on `plot-ask.mjs merge` and the `caller` reading: #2898, `feature/unattended-callers-are-refused`.
- The `plot/review` state and its SHA in the PR index (`plotReview`, `plotReviewSha`): #2900, `feature/the-index-records-the-review`.
- The scope reader: #2900, `feature/the-scope-is-read-from-git`.
- `rules/slice-pr-next.ts`, its input record (`newestMerged` included), its step union, its hold reasons, its composition order and the tick wiring: #2900, `feature/fleetd-reviews-slice-prs`.
- The repair and revert PR exception to the red hold, in `merge()` and `slicePrNext`: #2904, `feature/merge-admits-the-repair-pr`.
- The run-log lines for a merge and a hold, and an idle-slice rule that does not read a PR waiting its turn as idle: #2899, `feature/the-loop-keeps-a-run-log` and `feature/an-idle-slice-notifies`.
- The slice-progress line after a merge: #2905, `feature/merged-slices-update-the-comment`, which reads MERGED rows from the index rather than this plan's call.

## Slices

### Settled main guard

- `feature/merge-waits-for-a-settled-main` — `mergeAt` moves into the domain; `merge()` refuses `default-branch-unsettled` from a fresh `Refs.remoteSha` tip read and `review-not-passed` from a re-asked `plot/review`; `requireReading` holds a merge on a missing reading; domain unit tests for each refusal, including the three cases the panel probed <!-- builds: default-branch-unsettled and review-not-passed refusals in merge, mergeAt in the domain -->

### One merge per pass

- `feature/fleetd-merges-one-at-a-time` — the merge and hold arms of `slicePrNext`, `nextMerge` with one merge per pass, the merge in the daemon's automatic writes and never in `--once`, no retry of a `host-refused` merge at the same head, and the `Merger app` refusal on GitHub (D4); fleet unit tests over fake ports <!-- builds: the merge and hold arms of slicePrNext, nextMerge --> <!-- waits: feature/fleetd-reviews-slice-prs -->

## Notes

- Needs #2900 (plan PR #2917) for the review record, the scope reader and `slicePrNext`; #2898 (plan PR #2908) for the unattended refusal on `merge`.
- Panel round 1 tests to carry into the slices: `merge()` refuses probe cases (pending head past a green settled commit; reading on the pre-merge head; `null` reading with `requireReading`); the stale row holds where `defaultBranchRed` answers `false` on the same fixture; two mergeable PRs in one pass give exactly one `pr-merge` call; a pass after a merge with an unchanged reading and a moved tip merges nothing; `--once` merges nothing; the CI spawn ratchet count does not grow.
- Issue: https://github.com/plot-pm/plot/issues/2902. The plan writes nothing to the tracker.
