---
'@plot-pm/board': patch
---

`performLoopWrites` in `packages/board/src/server/entry/loop-writes.ts` applies the loop's decided writes through ports, one arm per `Write` kind `agentLoop` emits, with an exhaustive `switch` that fails `tsc` on an unhandled kind rather than a runtime `default`. Two new ports carry the writes no existing port could: `boundedRun`, which runs the prompt without `detached` so an external group stop still reaches it and its descendants, reading those descendants before it signals the root on its own bound or on the caller's exit; and `desk`, which writes the ending, the `PLOT-BLOCKED` marker, the declaration, the correction file, the limited record, the moved worker record and the findings lines, preserving each file's own best-effort or temp-file-and-rename property. `refs.remoteTip` reads the branch's live remote tip through `git ls-remote` (in `refs-remote-git.ts`, composed at the loop's wiring; the board's `refsGit` answers `unaskable`, so the poll path stays off the network) rather than the last-fetched local mirror, answering `unknown` rather than `other` on a failed or timed-out read. `Trees` gained `resetOnto`, `commit` and `push` for the claim sequence, and `Agents` gained `raiseAttempts`, `raiseCorrections` and `clearAssignment` for the counters and the assignment clear — each carrying the new value rather than an increment, so applying either twice lands the same number. `Processes.childrenOf` reads a pid's direct children, read-only, for the descendants a group stop snapshots before it kills the root.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
-->
