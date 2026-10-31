# Seams juror: the-fleet-scan-re-reads-what

Position: amend

## Summary

Slices 1 to 3 attack a real overrun, and slice 1 can ship almost as written. Slice 4 is already on `main`, and the board scan the Motivation saw at 14:34 is that shipped fallback taking over from a fleetd whose scans time out. Slice 5 names a port operation that already exists and none of the eight other callers of the scan. Slice 3 does not say that a dirty-set scan must still emit a whole reading, which the board and the bridge depend on.

## What I executed and what I only read

Executed (read-only): `git log`, `git grep` over callers, `sed -n` over the cited scan lines, `git ls-tree -r origin/main -- docs/plans` with counts per directory, `git for-each-ref` and `ls-tree` timings, `uptime`, a count of `scan failed` lines in `.plot/logs/fleetd.err`, and a `node` read of `.plot/state/last-pulse.json` for its `at`. I ran no scan, no test, no fleet or board command.

Only read: `packages/board/src/server/fleet.ts`, `packages/domain/src/rules/scan-owner.ts`, `packages/fleet/src/shared/fleet-scan.ts`, `packages/domain/src/ports/refs.ts`, `packages/domain/src/adapters/refs/refs-git.ts`, `packages/domain/corpus/README.md`, `scripts/check-shell-lines.sh`, `scripts/check-ancestry-decisions.sh`, and the plans `2026-10-26-the-fleet-scan-re-reads-all.md` and its neighbours.

## 1. Motivation

- The four cited sites match the code on this worktree: `ref_mode_of` at `plot-fleet-scan.sh:2782-2786`, the double `basename` at `:2883-2884`, the merge-subject loop at `:3715-3722`, and the ancestry pair at `:3762-3765`.
- "1242 plan files" is wrong. Executed on `origin/main` (`f76fb1057`): 1242 entries are 619 plan files, 621 `delivered/` symlinks and 2 `active/` symlinks. The loop count of 1238 fits because `plans[]` holds the index symlinks, which `readlink` resolves at `:3717`. Amend the line to say 619 plans and 623 index links.
- `fleetd.err` has no timestamps. Executed: 620 `scan failed: timed out` lines now, with no way to read a rate from them. State the window or the rate, or say the count is cumulative.
- The board scan at 14:34 is not an open question; the code answers it (see section 5).

## 2. Approach: the seams

### Slice 4 already exists

`fleetOwnsScan` (`packages/domain/src/rules/scan-owner.ts:37`, shipped in #1444, #1514 and #1557) decides who scans. The board calls it at `packages/board/src/server/fleet.ts:2815`, and when it answers true the board reads `last-pulse.json` and spawns nothing (`:2845-2846`). Slice 4 as written ("a board beside a live fleetd heartbeat reads `last-pulse.json` and runs no scan") is that rule.

The board scanned at 14:34 because the rule handed the scan to it. `writeScan` runs only after `scanOnce` returned, never after it threw (`fleet-scan.ts` doc comment above `writeScan`). A 90 s timeout throws, so the bridge keeps its old `at`. After two missed scans the bridge is older than `OWNED_BRIDGE_MAX_AGE_MS` (180 s, `scan-owner.ts:10`), and the board starts its own `--stream` scan with `record: false` (`fleet.ts:2820-2840`). The board's tick fires every 5 s beat (`boardDivisors`, `fleet.ts:~3120`). Executed at 14:49:14: the bridge `at` was 13:45:39Z, 3.5 min old, so a running board owned the scan at that moment.

This is a feedback loop: fleetd's timeout hands a second full scan to the board on the same machine, and that load lengthens fleetd's next scan. The plan should name it, because it is the reason the overrun is self-sustaining at load 8 to 10.

Amendment: drop slice 4, or replace it with the open decision that is actually left: should a board defer to a fleetd whose supervisor reads `up` while its bridge is stale because its scan is running or timing out? The answer touches `fleetOwnsScan`'s documented contract ("a loaded supervisor with a stale bridge is a daemon that hangs, and the board scans in its place"), so it is a domain rule change with its own unit tests in `scan-owner` and not a board change.

### Slice 5 names a port operation that exists, and no callers

`Refs.pulse()` already exists (`packages/domain/src/ports/refs.ts:391-400`) and runs `plot-fleet-scan.sh --json` (`refs-git.ts:549-554`). So the walk is already "behind the Refs port", and the slice as worded has nothing to do. What the slice means is: the walk moves into domain rules over the Refs primitives that already exist (`listBlobs`, `readBlobs`, `entriesAt`, `mergeBase`), and `pulse()` stops spawning the scan.

The scan has more callers than fleetd and the board, and each reads a different mode:

| Caller | Mode | Where |
|---|---|---|
| fleetd | `--stream` | `packages/fleet/src/shared/fleet-scan.ts:717` |
| board fallback | `--stream`, `PLOT_SCAN_RECORD=0` | `packages/board/src/server/fleet.ts:2821` via `scanOnce` |
| `Refs.pulse()` | `--json` | `refs-git.ts:550`, used by `adapters/sprint-scope-ref.ts:103` |
| `plot-dispatch.sh` | `--slice-names`, `--list-eligible` | `plot-dispatch.sh:3007`, `:3852`, `:3900` |
| `/plot-implement` | `--next <slug>` | `skills/plot-implement/SKILL.md:174` |
| `/plot-pulse` | `--log-pulse` | `skills/plot-pulse/SKILL.md:153` |
| `/plot-dispatch`, `/plot-reslice` | `<slug>` | `SKILL.md:71`, `SKILL.md:93` |
| `plot-fleetctl.sh` | recognises the process by path | `plot-fleetctl.sh:322`, `:337`, `:426` |
| corpus tier | spawns the scan as production oracle | `refs`, `branch-state`, `branch-state-waits`, `branch-state-waits-open-pr`, `eligible`, `tracked-branches`, `scan-listing`, `production.ts` |

Amendment: slice 5 must list these modes and say which stay in the shell, which move behind an entry point, and which corpus pairs lose their shell oracle. The corpus README forbids adjusting either side on a disagreement, and a pair whose shell side is deleted is retired by name, not left to fail. A plan that moves the walk for nine callers and eight corpus files is larger than one slice. Split it into its own plan, and keep this plan at slices 1 to 3.

### Slice 3 must still emit a whole reading

The board composes streamed `plan` lines over the previous pulse, and a plan absent from a finished scan disappears by design (`fleet.ts:2760-2770`, "a plan that has vanished from the scan must be able to disappear"). A finished scan that describes fewer plans is accepted but marked (comment block after `fleet.ts:2847`). `writeScan` writes the reading to the bridge, and `plot-delta.mjs` (`--log-pulse`, `a-pulse-says-what-changed`) compares readings over time.

So a dirty-set scan that emits only the dirty plans makes the board drop every clean row, marks each pulse as smaller, and writes a partial bridge. Amendment: slice 3 states that the terminal `reading` line, `--json` and the bridge always carry every plan, with clean plans folded from the last whole reading, and that only the work is incremental. Its done-condition is a byte comparison: on one pinned `origin/main` sha the incremental `--json` equals the cold `--json`.

Slice 3 also does not say where the dirty set lives. If fleetd computes it, the shell needs a new input like `PLOT_PR_LISTING` and `PLOT_TERMINAL_CACHE` (`fleet-scan.ts:732-735`), and every non-fleetd caller in the table above stays cold. If the shell computes it, the snapshot needs a home between runs, and `check-shell-lines.sh` charges the new lines against slice 1's savings. Name the choice.

### Inputs the snapshot misses

Open Question 1 must be answered before slice 3 starts, not during it. From the code, the scan also reads `PLOT_TERMINAL_CACHE`, `PLOT_PR_LISTING`, the host state cache (`plot-fleet-scan.sh:597-610`), worker and desk state through the sourced `plot-worker-state.sh`, and claim refs. A desk that goes `waiting` changes no ref and no plan blob. A snapshot of `for-each-ref` plus `ls-tree` misses it unless the desk reading is also re-read every beat.

## 3. Slices

- Slice 1 is the right first cut and can ship and be reviewed alone. Its text lists "ancestry" process starts, but the Approach step 1 does not, and parameter expansion cannot remove a `git merge-base` spawn. Move the ancestry pair to slice 2 (a cache keyed by the commit pair) or batch it, and say which.
- Slice 1 needs a checkable done-condition: on one pinned `origin/main` sha, `plot-fleet-scan.sh --json` before and after is byte-identical, and a timed scan at comparable load is stated with its load average.
- Slice 2 needs a stated home for the cache (see Open Question 2). A shell-side cache becomes throwaway when the walk leaves the shell.
- Slice 3 depends on the answers above and on slice 2's cache home.

## 4. What would break, and how we would know

- The board drops clean rows and marks every pulse smaller if slice 3 emits a partial reading. Test: a unit test over `refresh` where the scan emits only dirty plans, which must fail before the fold and pass after; and the `--json` byte comparison above.
- `--next`, `--list-eligible` and `--slice-names` give a wrong branch if the wave gate reads a stale ancestry or merge-subject answer. Test: the existing `eligible` and `branch-state*` corpus files on an unchanged estate, plus the pinned-sha byte comparison.
- `check-ancestry-decisions.sh` greps `*.ts` too (`:98`), so a TypeScript ancestry cache needs a `plot-ancestry: evidence` declaration within five lines.
- `check-shell-lines.sh pr` refuses a shell-side cache or snapshot that adds more commands than slice 1 removed.

## 5. Open Questions

- Q1 (other inputs): partly answerable now, see "Inputs the snapshot misses". Desk and worker state change no ref and no blob, so they must be re-read every beat or enter the dirty set through their own mtime.
- Q2 (cache across restart): keep it in fleetd's memory and hand it to the scan per run, the way `PLOT_TERMINAL_CACHE` already travels (`fleet-scan.ts:732-733`). A restart is a cold scan, which the plan already accepts. Persisting it adds a file under `.plot/state` that CLAUDE.md's *Answers, never verdicts* section would have to license, for a gain of one cold scan per restart.
- Q3 (board `--stream` steady state): answered from the code. It is the shipped fallback, triggered whenever fleetd misses two scans (`scan-owner.ts:37-43`). It is steady exactly as long as fleetd times out.
- Q4 (do slices 1 and 2 pay once slice 5 lands): slice 1 pays now, because the timeouts happen today and slice 5 is far. Slice 2 pays after slice 5 only if its cache lives in fleetd (TypeScript), not in the shell.

## 6. Amendments before approval

1. Replace slice 4 with the remaining decision about a hung `up` fleetd, as a change to `fleetOwnsScan` with `scan-owner` unit tests, or drop it. Cite #1444, #1514 and #1557, and name the feedback loop in Motivation.
2. Move slice 5 to its own plan, which lists every caller mode in the table above and every corpus file that spawns the scan, and says which pairs it retires.
3. Slice 3: state that every output (`--stream` terminal line, `--json`, the bridge) carries the whole reading; name where the dirty set is computed; answer Q1 first.
4. Slice 1: move ancestry out, and add the pinned-sha `--json` byte comparison as its done-condition.
5. Slice 2: keep the cache in fleetd memory, handed per run like `PLOT_TERMINAL_CACHE`.
6. Motivation: 619 plans and 623 index links, not 1242 plans; give the `fleetd.err` count a time window.
7. Notes: name `2026-10-26-the-fleet-scan-re-reads-all.md` (Released) as the owner of the 40 s listing cost in the no-carry case, and say this plan does not change the listing.
