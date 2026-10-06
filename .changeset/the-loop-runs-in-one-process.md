---
'@plot-pm/board': patch
---

`packages/board/src/server/entry/worker-loop.ts` gathers one pass's `AgentLoopReadings` through ports — the manifest, the desk's reset refusals and markers, the host's PR lookup, and the build connector's run for the pushed commit against the branch's live remote tip — in the table's own order, reading only what the place a pass is in calls for. A new `Transcript` port and its `transcriptFs` adapter (`packages/domain/src/ports/transcript.ts`, `adapters/transcript/`) answer the idle watch's transcript-silence reading, matching `plot_transcript_quiet_seconds` exactly, with a corpus pair (`corpus/transcript.corpus.test.ts`) holding the two in agreement. The launcher at the top of `plot-worker-loop.sh` reads `Worker loop` and `exec`s `board/plot-worker-loop.mjs` on `js`, exiting 2 with no silent fallback where the bundle is missing; `shell` stays the default and runs no Node.  An absent manifest `loop` field reads as `shell`.

<!--
plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md
-->
