# A slice waits on every branch it names

> `plot-plan-meta.sh` keeps only the last `<!-- waits: … -->` on a slice heading. A slice with two prerequisites loses every wait but the last, so it can read eligible while its other prerequisite has not merged.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1153
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-03, Jan Wloka, `bug/every-wait-reaches-the-verdict`
- **Started:** 2026-10-03, Jan Wloka, `bug/the-parser-reads-every-wait`

## Changelog

- A slice heading or branch line may declare several prerequisites, as several `<!-- waits: … -->` comments or as one comma-separated list. The parser reports every one, the scan holds the slice until all of them merge, dispatch refuses it while any has not, and the board names each prerequisite that still holds it.
- A `waits:` marker on a branch line whose value the parser cannot read as a branch is reported by the reconcile scan (`unread_waits=`), not dropped.

## Motivation

#1153, found 2026-10-01 in two Draft plans of this sprint:

- `docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md`, slice `bug/the-monitor-follows-the-hop`, declares `<!-- waits: bug/the-join-is-one-rule --> <!-- waits: bug/the-loop-reports-idle -->`. It parses as `waits_on: "bug/the-loop-reports-idle"`. The wait on `bug/the-join-is-one-rule` is gone.
- `docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md`, slice `bug/the-loop-reports-idle`, declares `<!-- waits: bug/idle-is-one-reading --> <!-- waits: bug/the-loop-waits-out-a-usage-limit -->`. It parses as `waits_on: "bug/the-loop-waits-out-a-usage-limit"`.

**Where the first wait is lost.** Measured on `origin/main` (`508abec3`), 2026-10-02. `plot-plan-meta.sh` reads `waits:` in two copies of one block, the list-item dialect (`:1076-1095`) and the slice-heading dialect (`:1295-1314`). Both run `sub(/^.*<!--[ \t]*waits:[ \t]*/, "", _w)`. The greedy `.*` consumes every marker but the last, and the rest of the line is cut at the first blank. The value lands in one scalar per branch, `waits_of[n]` (`:1169`, `:1354`), and the emitter writes `"waits_on":"<one name>"` (`:622`). The header comment states the limit: *"names ONE branch"* (`:133`). Nothing reports the dropped wait.

**Every reader of the field.** Measured on the same commit:

| Reader | Where | What it reads today |
|---|---|---|
| fleet scan, plan shim | `plot-fleet-scan.sh:2892-2902` | `b.get("waits_on") or "-"`, one tab-separated column |
| fleet scan, readings | `plot-fleet-scan.sh:3772-3779`, `:3821-3830` | one `waits` column into the branch-state readings and the order |
| fleet scan, payload | `plot-fleet-scan.sh:4040-4049` | emits `"waits_on":"<one name>"` per branch |
| branch-state entry | `packages/board/src/server/entry/branch-state.ts:205-210` | one `{ branch, pr }`, or `null` |
| branch-state rule | `packages/domain/src/rules/branch-state.ts:48-59`, `:119` | `waits: WaitsReading \| null` |
| wait verdict | `packages/domain/src/rules/eligible.ts:213-220` | `waitVerdict(waitsOn: string, answer)` |
| slice transition | `packages/domain/src/transitions/slice.ts:326-405` | `prerequisiteCleared` over one `waitsOn` |
| pulse schema | `packages/domain/src/entities/fleet.ts:200` | `waits_on: z.string().default('')` |
| board row sentence | `packages/board/src/server/fleet.ts:4389`, `:5123`, `:6581` | one `waitsOn` string |
| dispatch preflight | `plot-dispatch.sh:2928-2948` (`waits_pairs`) | awk `"waits_on":"[^"]*"`, one pair per branch |
| reconcile §18 | `plot-reconcile-scan.sh:2207` ff. | the raw line, presence of a `waits:` marker only |
| domain corpus | `packages/domain/corpus/branch-state.corpus.test.ts:237-300` | one `waitsOn` per branch |

`packages/domain/src/adapters/plan-store/plan-store-shell.ts` `branchOf` (`:46-51`) does not read the field today. The approved plan `the-queue-reads-the-order-the-scan-reads` (#1100) adds it there as `PlanRecordBranch.waitsOn: string` in its slice `bug/the-queue-reads-the-scans-order`, with a `waits` hold in `rules/queue.ts`.

## Design

### The field becomes a list

**`waits_on` becomes `waits_on: ["bug/a", "bug/b"]`**, in the plan's order, with duplicates removed. The key stays ABSENT where a branch declares no wait, never `[]`, for the reason the header gives today: absent and empty are different answers.

**Why a list, and not `waits_on` plus `waits_on_all`.** A second field keeps `waits_on` as a lossy first value. Every reader nobody migrates keeps reading one prerequisite, the slice still reads eligible early, and nothing fails to show it, which is the defect this plan fixes. A changed type fails where a reader is not migrated: Python receives a list, TypeScript does not compile, and the schema refuses. One reader fails silently instead. `waits_pairs` in `plot-dispatch.sh` matches `"waits_on":"[^"]*"`, and that pattern does not match a list, so an unmigrated dispatch reads every slice as waiting on nothing. That reader is migrated in the same slice as the parser, and a dispatch test with two waits holds it.

**Two spellings, one answer.** A line may carry several `<!-- waits: x -->` comments, or one `<!-- waits: x, y -->`. The parser reads every marker on the line and splits each value on commas. Each name must still match `^(PREFIXES)/[^ \t,]+$`, the rule that keeps a syntax example from becoming a declaration.

**A wait the parser cannot read is reported.** On a line that names a branch (a list item or a `(Branch: …)` heading), a `waits:` marker whose value is not a branch name goes to a new per-plan field, `unread_waits[]`, as `{ branch, value }`. Reconcile reports it in a new section `unread_waits=`, below the blocking marker, the way section 24 reports `unread_headings=`. It reports and never gates. A `waits:` marker on a prose line stays silent, as today.

### The verdict over several waits

`waitVerdict` takes `readonly { branch, answer }[]`. An empty list answers `''`. Any `none` answers `blocked`. Otherwise any `unmerged` or `unreachable` answers `waiting`. All `merged` answers `''`. `blocked` outranks `waiting`, because a typo needs a plan edit and no merge clears it. `prerequisiteCleared` refuses on the first prerequisite that has not cleared, in the plan's order, and names it. `WaitsReading | null` becomes `readonly WaitsReading[]`.

**The pulse carries the list too.** `FleetBranch.waits_on` becomes `z.array(z.string())`, with a preprocess that reads a legacy string as a one-item list and `''` as `[]`, because `.plot/state/last-pulse.json` persists the old shape. The board row names every prerequisite that still holds the slice: *"waits on bug/a and bug/b"*.

### Order against #1100

#1100's slice `bug/the-queue-reads-the-scans-order` lands first, with `waitsOn: string`. Slice 1 here waits on it and changes `PlanRecordBranch.waitsOn` to `readonly string[]` and the `waits` hold to clear only when every prerequisite is in the merged set. The parser change comes last (slice 2), so no reader meets a list before it can read one. Every domain and board reader in slice 1 also accepts the old single name as a one-item list.

### What this does NOT do

- It does not read a wait that crosses repositories. A prerequisite is still a branch in this repo.
- It does not change reconcile §18, which reads the raw line for the presence of a marker. A test asserts that a line with two markers still counts as annotated.

## Slices

### Every wait reaches the verdict (Branch: bug/every-wait-reaches-the-verdict) → #1253 <!-- waits: bug/the-queue-reads-the-scans-order -->

`waitVerdict`, `prerequisiteCleared`, `WaitsReading[]` in `rules/branch-state.ts`, the `FleetBranch.waits_on` array with its legacy preprocess, `PlanRecordBranch.waitsOn: readonly string[]` and the `waits` hold in `rules/queue.ts`, `entry/branch-state.ts` reading a comma-separated waits column (one name is a one-item list), the board row sentence in `fleet.ts`, the corpus test, rebuilt bundles, a changeset for `plot` and `@plot-pm/board`. The scan still sends one name, so behaviour on `main` does not change until slice 2. <!-- builds: waitVerdict over a list of prerequisites -->

### The parser reads every wait (Branch: bug/the-parser-reads-every-wait) <!-- waits: bug/every-wait-reaches-the-verdict -->

Both `waits:` blocks in `plot-plan-meta.sh` read every marker and every comma-separated name; the emitter writes `"waits_on":[…]`; `unread_waits[]`; the header comment at `:133`. In the same branch: the fleet-scan shim joins the list with commas into its column and the payload emits an array; `waits_pairs` in `plot-dispatch.sh` prints one pair per prerequisite; `branchOf` maps the array; reconcile's `unread_waits=` section and footer counter. Rebuilt bundles and a changeset. <!-- builds: the waits_on list and unread_waits -->

## Done when

Each test below fails on `origin/main` today:

- `test/reconcile/parser.test.mjs`: a slice heading with `<!-- waits: bug/a --> <!-- waits: bug/b -->` reports `waits_on: ["bug/a","bug/b"]`; a list item with `<!-- waits: bug/a, bug/b -->` reports the same; a branch with no marker carries no `waits_on` key; `<!-- waits: <branch> -->` on a branch line lands in `unread_waits` and not in `waits_on`; the same marker on a prose line lands in neither. Both live plans parse with both waits.
- `packages/domain` unit tests: `waitVerdict` over `[merged, unmerged]` answers `waiting`, over `[unmerged, none]` answers `blocked`, over `[merged, merged]` answers `''`; `prerequisiteCleared` names the first unmerged prerequisite; `FleetBranchSchema` reads `"bug/a"` as `["bug/a"]` and `""` as `[]`; the queue holds a slice with one merged and one unmerged prerequisite as `waits`. 100 % branch coverage holds for the touched rules.
- `test/reconcile`: the fleet scan reports a slice `waiting` while one of its two prerequisites has not merged, and its payload carries both names; dispatch refuses that slice and names the unmerged prerequisite; reconcile prints `unread_waits=1` for a branch line whose waits value is not a branch, and §18 still counts a two-marker line as annotated.
- `packages/board` unit test: a NOT STARTED row names both prerequisites that hold it.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass.

## Notes

- The field is the plan-format contract (CLAUDE.md, *A Shell Script Asks The Domain*). Every reader above is named and changed in one of the two slices; a reader found later belongs to slice 2.
- This plan's own slice 1 declares one wait, so the parser on `main` reads it correctly before slice 2 lands.
- 2026-10-03, `scripts/check-shell-lines.sh` (`the-shell-shrinks-into-the-domain`, wave 1) refuses a pull request whose shell under `skills/` is longer than at its merge base. Offset the lines in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.
