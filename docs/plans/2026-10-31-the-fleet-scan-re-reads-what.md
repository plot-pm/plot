# The fleet scan re-reads what did not change

> fleetd's scan takes 57 s under load against a 90 s budget, and 40 s of that is four per-plan shell loops that start a process per plan on every beat. A timed-out scan leaves the bridge stale, the board then starts a second scan, and that load times out the next one.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Issue:** #2978
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2979 merged
- **Started:** 2026-10-31, Jan Wloka, `feature/the-scan-walk-starts-no-process-per-plan`
- **Started:** 2026-10-31, Jan Wloka, `feature/a-fleetd-whose-scans-start-owns-the-scan`
- **Started:** 2026-10-31, Jan Wloka, `feature/the-subject-walk-skips-settled-plans`

## Changelog

- The fleet scan starts no process per plan, skips the merge-subject walk for settled plans, and a board beside a live fleetd whose scans keep starting shows the bridge's age instead of starting a second scan.

<!-- Board impact: slice 2 changes when the board scans and adds the bridge's age to what it shows; slices 1 and 3 change no output the board consumes, proved by a byte comparison of the scan's --json. -->

## Motivation

`.plot/logs/fleetd.err` holds 620 lines `plot-fleetd: scan failed: timed out after 90000ms`. The lines carry no timestamp and the file is not rotated, so the count is cumulative over several fleetd runs and gives no rate. Observed from 14:34 to 14:54 on 2026-10-31 at load about 7.8: fleetd started 5 scans, which lived 48, 50, 92, 62 and 53 s, and 1 of the 5 timed out. `FLEET_SCAN_BUDGET_MS` is 90 s (`packages/fleet/src/shared/fleet-scan.ts:48`).

Measured 2026-10-31:

- One scan with the PR listing carried, as fleetd runs it: 56.7 s wall, 29.9 s CPU (user 14.05 s, sys 15.82 s), load 8.5 to 10.1. Two `--offline --json` runs: 29.6 s and 27.7 s CPU, 249 s and 64 s wall, at load 7.8 to 8.9. CPU is stable; wall time measures the load.
- One scan with no carried listing: 149 s wall, 34 s CPU. The PR listing took about 40 s of it. That cost belongs to `2026-10-26-the-fleet-scan-re-reads-all.md` (Released), and this plan does not change the listing.
- `origin/main` holds 619 plan files, 621 `delivered/` links and 2 `active/` links under `docs/plans`. The scan's `plans` array holds the index links, about 1240 entries.
- A per-line trace (`PS4` with `EPOCHREALTIME`) puts about 40 of the 57 s in four sites in `skills/plot/scripts/plot-fleet-scan.sh`:

| Site | Work | Calls | Time |
|---|---|---|---|
| `:3716-3722` merge-subject loop | `basename "$(readlink …)"` and a `case` match over all of `$SUBJECT_ADDING`, per plan | 2476 + 1238 | 15.6 s |
| `:2883-2884` `ref_plan_file` | `$(basename "$p")` twice per plan | 3095 | 9.3 s |
| `:2783` `ref_mode_of` | `printf \| awk` over the whole `ls-tree` output, per plan | 1238 | 5.5 s |
| `:3762-3765` ancestry | `git merge-base --is-ancestor` and two `git cat-file -e`, per refless branch | 297 | 7.7 s |

- One `basename` costs about 70 ms at load 7; a parameter expansion costs about 0.2 ms.
- **The overrun feeds itself.** fleetd writes the bridge (`last-pulse.json`) only after a scan succeeds (`packages/fleet/src/shared/fleet-clock.ts:149-152`). `fleetOwnsScan` (`packages/domain/src/rules/scan-owner.ts:37`, #1444, #1514, #1557) hands the scan to the board when the bridge is older than `OWNED_BRIDGE_MAX_AGE_MS` (180 s). Two timed-out scans therefore make the board start its own `plot-fleet-scan.sh --stream` (`packages/board/src/server/fleet.ts:2815-2823`). On 2026-10-31 the board's scan and fleetd's scan ran and fetched in this repository at the same time, and at 14:49 the bridge was 3.5 minutes old.
- The merge-subject loop walks every entry of `plans`, settled plans included, while the row loop drops released, rejected and superseded plans, and delivered docs and infra plans, unread (`plot-fleet-scan.sh:4305-4312`).

## Design

### Approach

1. **The scan starts no process per plan.** Parameter expansion replaces `basename`. One pass over `PLAN_MODES` and the index links builds the symlink, mode and adding-commit lookups, and each per-plan read is a lookup in that table. The ancestry calls at `:3762-3765` stay; slice 3 and the second plan remove them. Output stays byte-identical.
2. **A fleetd whose scans keep starting owns the scan.** fleetd records each scan attempt: when it started, when it ended, and whether it succeeded or timed out. `fleetOwnsScan` keeps fleetd as owner while fleetd's last scan attempt started within 2 × `FLEET_SCAN_BUDGET_MS`, even when the bridge is older than 180 s. A board in that state starts no scan and shows the bridge's age and fleetd's last failure, so a stopped bridge is never shown as current. A fleetd that starts no scan for 2 × `FLEET_SCAN_BUDGET_MS` hands the scan to the board, as today. This is a domain rule change with unit tests in `packages/domain/test/scan-owner.test.ts`.
3. **The merge-subject walk skips settled plans.** The slice first proves which readers consume the subject answers of a settled plan (`SLICE_NAMES`, cross-plan `<!-- waits: -->` edges and the row loop are the candidates). It filters the walk to the plans whose answers some reader consumes, and keeps every plan that a `waits:` edge or an unsettled slice names. If a reader needs every plan, the slice records that finding in the plan and changes nothing.

### Decisions

- **The oid cache, the dirty set and the domain walk move to a second plan**, "The plan walk moves into the domain", raised as its own issue. It has nine caller modes and eight corpus files that spawn the scan, and the panel showed a cache in the shell would carry verdicts across beats. That plan starts from this panel's input table (`.plot/panels/the-fleet-scan-re-reads-what/safety.md`, section 2) and these rules:
  - A cached answer is a function of the objects in its key, read through those oids and never through a ref name.
  - `unknown` and failed reads are never cached.
  - The key includes the parser version and a digest of the Plot Config.
  - Ancestry entries are refused on a shallow repository or when `refs/replace` is not empty.
  - The dirty set bounds reads only; verdicts stay a function of all readings on every beat.
  - Every output carries every plan.
  - The cache lives in fleetd's memory and is not shared with the dispatch re-check.
- **No disk cache in this plan.** Slices 1 to 3 add no file under `.plot/state`. Slice 2 adds scan-attempt fields to what fleetd already records.
- **Merge and delivery are out of reach.** `plot-ask.mjs merge` and `plot-pr-merged.sh` ask the host again, so no change here can cause a wrong merge or delivery.
- **The shell line ratchet.** Slice 1 removes lines. Slice 3 must fit within the room slice 1 leaves, and `scripts/check-shell-lines.sh pr` decides.

### Open Questions

- [x] Slice 3: which readers consume the subject answers of a settled plan? Three: `merged_by_subject` and `subject_predates_plan` at `plot-fleet-scan.sh` `:3956`, `:4544` and `:4754`, all inside the row loop. That loop skips `released`, `rejected` and `superseded` plans at `:4292`; a `delivered` plan stays in the pulse and is asked (a delivered docs or infra plan leaves at `:4299`, and the walk still asks it, because the shell-line ratchet leaves no room for the extra test). The subject walk skips the three phases. `is_terminal_phase` alone would be too wide because it includes `delivered`. Measured on this checkout (small estate, load 5): `--offline --json` 2.07 s user+sys against 2.16 s before, normalised JSON identical.

## Slices

### Process starts

- `feature/the-scan-walk-starts-no-process-per-plan` — replace the per-plan `basename`, `readlink`, `case` and `printf | awk` process starts at `plot-fleet-scan.sh:2783`, `:2883-2884` and `:3716-3722` with parameter expansion and one lookup table, output byte-identical <!-- builds: single-pass symlink, mode and adding-commit lookup in plot-fleet-scan.sh --> → #2982

### Scan ownership

- `feature/a-fleetd-whose-scans-start-owns-the-scan` — fleetd records each scan attempt; `fleetOwnsScan` keeps a fleetd whose last scan started within 2 × `FLEET_SCAN_BUDGET_MS` as owner; the board shows the bridge's age and fleetd's last scan failure instead of scanning <!-- builds: scan attempt in fleetd's record, fleetOwnsScan reads it --> → #2983

### Settled plans

- `feature/the-subject-walk-skips-settled-plans` — prove which readers consume a settled plan's subject answers, then filter the merge-subject walk to the plans some reader needs <!-- builds: settled-plan filter on the merge-subject loop -->

## Done when

All comparisons run on one pinned clone (`packages/domain/corpus/pin-clone.ts`) with no host token and no carried listing, and normalise the output with `jq -S 'walk(if type=="object" then del(.changed_ago_seconds) else . end)'`. CPU is user + sys from `/usr/bin/time -p`, reported with the load average.

- **Slice 1:**
  - `plot-fleet-scan.sh --offline --json` before and after the change gives byte-identical normalised output.
  - A debug dump of `SUBJECT_PLAN_SECTIONS`, `_sp_pairs` and `_sp_answers` is identical before and after.
  - CPU of the same invocation drops by at least 15 s from about 29 s.
  - `node --test test/reconcile/fleetsubject.test.mjs test/reconcile/fleetrefplans.test.mjs test/reconcile/fleetreadref.test.mjs` passes.
  - `scripts/check-shell-lines.sh pr` and `scripts/check-ancestry-decisions.sh` pass.
- **Slice 2:**
  - `pnpm --filter @plot-pm/domain exec vitest run test/scan-owner.test.ts` passes, with cases for:
    - a live fleetd whose last scan started 100 s ago and whose bridge is 200 s old (fleetd owns);
    - a live fleetd that started no scan for more than 2 × `FLEET_SCAN_BUDGET_MS` (the board owns);
    - a stopped fleetd (the board owns, as today).
  - A board unit test shows the bridge's age and fleetd's last failure when fleetd owns a stale bridge.
- **Slice 3:**
  - The plan records which readers consume settled plans' subject answers, with the file and line of each.
  - Slice 1's normalised `--json` comparison and subject-dump comparison hold for every plan that is not settled.
  - The `eligible`, `branch-state` and `branch-state-waits` corpus files pass unchanged in CI.
  - CPU of the `--offline --json` run drops further, stated with the load.

## Notes

- Raised from issue #2978 on 2026-10-31.
- Panel round 1, 2026-10-31: unanimous amend (layering, safety, testability, seams); verdicts and moderation in `.plot/panels/the-fleet-scan-re-reads-what/`.
- The PR listing cost with no carried listing belongs to `2026-10-26-the-fleet-scan-re-reads-all.md` (Released).
- The second plan, "The plan walk moves into the domain", holds the object-id cache, the dirty set and the domain walk.
