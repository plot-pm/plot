---
'plot': patch
---

The shell worker loop asks `desk_reset_refusal` about its own desk right after a prompt exits `ran`, before `seal_declaration`, `record_slice_spend` or `clear_manifest_branch` run. On `uncommitted-changes` or `unpushed-commits` it writes the ending `holding-work`, actor `agent`, with `desk_hold_reason`'s phrase as the detail, logs one line, and exits 0 without hopping to a new desk — fixing the failure measured twice on 2026-10-03 and 2026-10-04 (#1246), where an agent ending its turn mid-background-job left 14 files on a desk no agent and no manifest named. `EndingReasonSchema` gains `holding-work` and `endingIsAttributable` admits actor `agent` for it, beside `unstarted`, `limited` and `unregistered`. Every ending `write_ending` records is now also appended as one JSON line to `.plot/state/endings.jsonl` in the main checkout, best effort, so a window of past endings survives the reaper removing a finished desk.

<!--
plan: docs/plans/2026-10-04-the-shell-loop-holds-unlanded-work.md
-->
