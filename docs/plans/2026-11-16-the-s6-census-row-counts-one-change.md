# A census change pass ends after the tick its scan started

> The fleetd census entry holds a pass open while fleetd's supervision tick runs, so S5 counts the whole desk-commit change and S6 counts only the CI-green change, and both rows read the same count on every run of the same commit.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bug-fixes-2-35-0
- **Issue:** #3471
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3475 merged
- **Started:** 2026-11-16, Jan Wloka, `bug/the-s6-census-row-counts-one-change`

## Changelog

- The process census counts each change of S5 and S6 in its own pass, so `census-compare` no longer fails S6 on one run and passes it on a rerun of the same commit.

<!-- Board impact: none. No change to the plan format, the template, the helper scripts or the docs/plans layout. -->

## Motivation

On release PR #3444 at `7795279e1` (2026-11-16), `census-compare` failed S6 ("one PR whose CI turns green", GitHub, 3 desks, 5 open PRs): HEAD 881 execve per change against a limit of 648.8, merge base 588 (run 43878173423, attempt 2, job 133367381906). Attempt 4 of the same run passed with HEAD 589 and merge base 589 (job 133381535944). The release PR changes only versions and changelogs.

**The failing run moved work from S5 into S6.** The same compare printed `ok S5 github desks=3 prs=5: HEAD 303, merge base 595`. S5 passes because a lower count never fails the gate. The census-head logs give the split:

| Job | S5 | S6 | S5 + S6 |
|---|---|---|---|
| census-base, attempt 2 (133360940961) | 595 | 588 | 1183 |
| census-head, attempt 2 (133360941090) | 303 | 881 | 1184 |
| census-base, attempt 4 (133374715284) | 596 | 589 | 1185 |
| census-head, attempt 4 (133374715432) | 596 | 589 | 1185 |

On the failing head job, S5 lost `grep` 48, `git` 40, `awk` 41, `sed` 36 and `bash` 31 against its base (`grep x78, git x83, awk x47, sed x39, bash x43` against `grep x126, git x123, awk x88, sed x75, bash x74`). S6 gained the same images: `grep` +48, `git` +40, `awk` +41, `sed` +36, `bash` +31. About 293 execve of the desk-commit change ran after the `pass-4` mark and fell in S6's window (`packages/fleet/test/census/fleetd.census.test.ts:367` counts S5 between `pass-3` and `pass-4`; `:373` counts S6 between `pass-4` and `pass-5`).

**The cause is the settle rule of a normal pass.** `pass` in `packages/fleet/test/census/fleetd-census-entry.ts:304-331` advances the clock (`:327`) and then waits on `quiet()` alone (`:328`). `quiet()` (`:275-280`) returns once no direct child and no in-process HTTP request is in flight, 300 ms have passed since the last one ended (`QUIET_MS`, `:56`), and fleetd's bridge does not read a `running` scan (`scanBusy`, `census-settle.ts:31-42`). A change pass holds two stages of work. The scan drains the pending change and, through `drained: wake.trigger` (`packages/fleet/src/server/entry/registryd-main.ts:3489`), starts the supervision tick (`runTick`, `:3763`). The bridge tracks the scan and does not track the tick. Between the scan's last child and the tick's first child, the tick does in-process reads and starts no child. Where that gap exceeds 300 ms of the real clock, as it can under `strace -f` on a CI runner, `quiet()` returns, the entry places the `pass-4` mark, and the tick's children are counted in the next pass. The two halves of S5's 596 (303 and 293) match one scan and one tick.

**#3454 fixed the same class of race for the safety-net pass only.** Commit `8c2682388` added `scanEnded` (`fleetd-census-entry.ts:287-297`), which a safety-net pass awaits after its last beat (`:321-326`). The normal `pass` path, which S5 and S6 use, kept `quiet()` alone. A wait for a scan does not close this gap, because here the scan has ended and the tick has not started its first child.

**The defect exists on `main` at `5850be951`.** The code above is unchanged there.

The effect for a person: a PR that does not change fleetd can fail `census-compare` on S6, and the rerun passes. The same race can lower S6 and raise the first safety-net window of S8, and it hides a real S5 increase behind a low count.

## Design

### Approach

The fix lives in the census harness only: `packages/fleet/test/census/`. No product code changes, no shell/domain duplicate is declared and no corpus row is added.

1. **Count a running tick as in flight.** `run` takes `RunSeams.tick` (`registryd-main.ts:2838`), present on `main` since #1523. The entry imports the product's `tick` through a new specifier `census-product:tick` (`packages/fleet/src/server/entry/registryd.ts:374`) in `fleetd-entry-build.ts:13-15`, and passes `{ clock, tick: trackedTick }` to `run` (`fleetd-census-entry.ts:346`). `trackedTick` adds one to `inFlight` before it calls the product's `tick`, and on return or throw subtracts one and sets `lastSettled`, as `track` does for a child (`:73-94`). Because the seam already exists, the merge-base product takes the same wrapper, so both halves of the census measure the same way on the PR that lands the fix.
2. **Put the settle decision in a pure function.** `census-settle.ts` gains `passSettled({ inFlight, sinceSettledMs, scanBusy, quietMs })`, and `quiet()` calls it. `census-settle.unit.test.ts` covers it, as it covers `scanBusy` and `scanEndedSince`.
3. **Print the split.** The S5 and S6 rows print the real milliseconds of their pass and the number of ticks the pass ran, as S8 prints `ms per pass` (`fleetd.census.test.ts:266`). The entry counts the ticks in `trackedTick` and adds them to its done line: `census: pass <n> done ticks=<k>`. The driver's pattern (`fleetd-driver.ts:98`) accepts the suffix.
4. **Assert that each change pass ran its tick.** In `fleetd.census.test.ts`, the S5 and S6 rows assert that their pass ran at least one tick. A pass that settles before its tick then fails by name rather than moving its count into the next row.
5. Add a changeset for `plot` (patch) with a `bumps:` block naming `plot`.

No tolerance changes, and no row is marked as expected to fail.

### Open Questions

- [x] **Does the harness wrap the existing tick seam, or does the product report when its loop is parked?**
  - A: Wrap `RunSeams.tick` in the entry, as above. It needs no product change, and the merge-base product accepts it at once. It does not hold the pass across the short gap between `wake.trigger` and the start of `runTick`, which is in-process work in one loop iteration.
  - B: Add a product seam, `RunSeams.parked?: (parked: boolean) => void`, which `pause` (`registryd-main.ts:3652`, `wake.wait` at `:3660`) calls before and after `wake.wait`. The entry then settles only while fleetd's loop is parked with no trigger pending. It closes every gap, but the merge-base product ignores the seam until the fix is on `main`, so the PR that lands it still measures the base with the old race.
  - **Recommendation: A.** It closes the measured gap with no product change, and it measures both sides alike from the first PR. Take B only if the census logs from step 3 show a leak with A in place.
  - **Decided 2026-11-16, Jan Wloka: option A.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| A pass with a tick in flight is not settled, and one with no tick, no child, no request and no running scan past the quiet window is settled | `pnpm --filter @plot-pm/fleet exec vitest run test/census/census-settle.unit.test.ts`: the new `passSettled` tests pass; they fail before the slice because `passSettled` does not exist | Tick in flight |
| The entry counts the product's tick through `RunSeams.tick` on both halves | `pnpm --filter @plot-pm/fleet exec vitest run test/census/fleetd-entry.unit.test.ts`: a new test reads `ticks=` on the done line of a pass after a desk commit and expects at least 1 | Tick in flight |
| S5 and S6 each count their own change | CI `census-head` on the slice's PR prints S5 and S6 with `ticks=` of at least 1 each, and S5 + S6 stays within 2 of the merge base's sum | Tick in flight |
| S6 does not vary between runs of one commit | Three CI runs of the slice's head commit (one push and two reruns of `census-head` / `census-base` / `census-compare`): every attempt reads S6 HEAD within 10 % + 2 of its merge base, and S5 likewise | Tick in flight |

## Slices

### Tick in flight

- `bug/the-s6-census-row-counts-one-change` — `packages/fleet/test/census/fleetd-census-entry.ts` (`trackedTick`, the `ticks=` done line, `quiet()` through `passSettled`), `fleetd-entry-build.ts` (`census-product:tick`), `census-settle.ts` (`passSettled`), `fleetd-driver.ts` (done-line pattern), `fleetd.census.test.ts` (S5 and S6 print `ms` and `ticks`, and assert a tick), tests in `census-settle.unit.test.ts` and `fleetd-entry.unit.test.ts`, and a changeset for `plot` (patch, `bumps:` naming `plot`) <!-- builds: passSettled, a census settle rule that holds a pass while fleetd's tick runs --> → #3481

## Notes

- `plot-deliverable-search.sh "a census pass settles once fleetd's tick and scan are idle"` and `"census pass waits for the tick"`: no hit in `packages/fleet/test/census/`; the hits name unrelated uses of "census" (`ci-reuse.ts`, `ci-job-map.jq`, `signals.ts`) and of "settles" and "waits" in shell comments. No duplicate.
- Related: PR #3454 (`8c2682388`, "the S8 census counts one deterministic safety-net pass") fixed the same class of race for the safety-net pass with `scanEndedSince`. This plan extends the settle rule to the normal pass and leaves `scanEnded` unchanged.
- The S8 row on GitHub with 3 desks reads its first safety-net window at 900 to 902 and the next two at 313 and 316 on all four census jobs above. That shape is stable between runs and is outside this plan.
- Census plan: `docs/plans/2026-11-08-process-census-gate.md`. Contract: `docs/process-census.md`.
