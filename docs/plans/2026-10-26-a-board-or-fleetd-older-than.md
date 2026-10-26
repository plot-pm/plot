# A board or fleetd older than the gate spawns runs the gate refuses

> A board or fleetd that started before the gate gained a marker spawns unattended runs without that marker, and nothing names the gap.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2728
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The main-checkout gate names a missing `PLOT_MAIN_CHECKOUT_WRITER` marker and the likely cause, a spawner older than the gate, in its refusal.
- The board and fleetd report themselves stale when the bundle on disk differs from the bundle they started from.

<!-- Board impact: the board's status payload gains a staleness field if the second slice is built; no plan format, template or helper script changes. -->

## Motivation

Issue #2728 records one failure measured on 2026-10-26. The board (pid 23604) started 2026-10-20 09:33 and fleetd (pid 8692) started 2026-10-17 17:15. Neither reloads its bundle. `PLOT_MAIN_CHECKOUT_WRITER` arrived in `da7097509` (#2317, 2026-10-22), and the board bundle (`275a8704e`) and fleetd bundle (`286e0483a`) those processes ran contain it 0 times.

Every agent session loads the current plugin gate (2.28.1 `plot-gate.mjs` checks the marker). An implement run spawned by the stale fleetd gets `PLOT_UNATTENDED=1` without the marker, so `gatesMainCheckout` (`packages/domain/src/rules/main-checkout-write.ts:32`) refuses the commit that `implement-run.ts:617` is designed to make. The agent improvises a disposable worktree and leaves its first writes in the main checkout (#2725). The board and fleetd were restarted at 21:18 on 2026-10-26.

The gap covers every role that sets the marker: implement (`implement-run.ts:617`), deliver (`board/src/server/deliver.ts:649`), reslice (`reslice.ts:473`), story (`story.ts:514`), auto-deliver (`auto-deliver.ts:272`), brief-ask (`brief-ask.ts:163`) and the dispatch brief launch (`plot-dispatch.sh:827`). The continuation launch clears the marker on purpose (`continuation.ts:1116`) and is not affected. The failure shows only as an agent working around a refusal, so no log line points at the stale process.

## Design

### Approach

Two independent detections, because each catches a different reader.

1. **The gate names the cause.** When `gatesMainCheckout` refuses, the refusal text states that `PLOT_UNATTENDED=1` is set without `PLOT_MAIN_CHECKOUT_WRITER`, and that a spawner started before the marker existed produces exactly this state. The text names the board and fleetd restart as the check. This is the cheapest slice: it changes one message in `packages/board/src/server/entry/gate.ts` and needs no new state. It helps the agent and the operator reading the transcript, and it covers all seven roles at once.
2. **The spawner reports itself stale.** The board and fleetd record the identity of their bundle at start (the file's content hash or mtime) and compare it with the bundle on disk on each status read. A mismatch adds `stale: true` and the two identities to `--status` output and the board payload. The operator sees the gap before an agent runs into it.

Refusing to spawn a marker-dependent role from a stale spawner (the issue's third option) is not in the plan. A stale spawner cannot know which markers the current gate expects, and a refusal there would stop a fleet that works under every older gate.

`bundle identity` is a bought reading of the file system, not a verdict; the comparison is derived fresh on each read and nothing persists it (see *Answers, never verdicts*).

### Open Questions

- [ ] Content hash or mtime for the bundle identity? A hash survives a `touch`; an mtime avoids reading a multi-megabyte bundle on each status call.
- [ ] Where does the staleness show: `plot-board --status` and `plot-fleet --status` only, or also a banner on the board page?
- [ ] Does the gate message belong in the domain rule (`main-checkout-write.ts`) or in the entry (`gate.ts`)? The domain owns wording that a test asserts; the entry owns the refusal envelope.
- [ ] Does a bundle change that adds no marker still count as stale? Flagging every rebuild is noisier than flagging a marker gap, and cheaper to implement.

## Slices

### Gate

- `feature/a-board-or-fleetd-older-than-gate` — the refusal names the missing marker and the stale-spawner cause, with a domain test per refusal wording and a board gate test <!-- builds: a refusal message naming a missing PLOT_MAIN_CHECKOUT_WRITER marker -->

### Spawner

- `feature/a-board-or-fleetd-older-than-spawner` — the board and fleetd compare their start bundle with the bundle on disk and report `stale` in their status <!-- builds: a bundle staleness reading for the board and fleetd -->

## Notes

Source: the #2726 panel, round 1 (`.plot/panels/2026-10-26-implement-leaves-its-brief-and-plan/` on `idea/implement-leaves-its-brief-and-plan`). Related: #2725.

The board does not reload its bundle: after a fast-forward of `main` the board and fleetd need a restart, and nothing today says so.
