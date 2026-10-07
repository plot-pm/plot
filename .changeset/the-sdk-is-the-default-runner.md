---
'plot': patch
---

`scripts/count-fleet-turns.mjs` reads the main checkout's fleet (`sdk-cli`) transcripts and the slice-spend record to report, per day and per runner (`command` vs `sdk`), fleet sessions, turns per session, mean peak context, weighted tokens, weighted tokens per sealed slice, and completed/refused polling calls, then compares a `command` baseline against an `sdk` window across two slice-size groups against the bar `the-sdk-is-the-default-runner` sets. On this repository the bar cannot be evaluated yet — `## Plot Config` names no `Agent runner` key, so no slice has ever run on `sdk`, and this machine's `.plot/state/` carries no `slice-spend.jsonl` at all, so even the `command` baseline has no sealed-slice record to read. `defaultsToSdkWhenNamed` stays `false` at its three call sites until a later run finds the bar met.

<!--
plan: docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md
bumps:
  skills:
    plot: patch
-->
