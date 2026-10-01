---
'plot': patch
'@plot-pm/board': patch
---

A new domain rule reads a harness's usage limit instead of a broken prompt. Part of #1141. Measured 2026-10-01, a harness that stopped on the account's session limit exited like a prompt that could not start: the worker spent three retries in 974 ms and wrote a marker telling a person to fix a prompt file that worked, on a desk holding two pushed commits and ten uncommitted files. `rules/prompt-exit.ts` answers one of four words — `wait` with the reset instant, `end-limited` with the cause `no-reset`, `past-bound` or `no-progress`, or today's `unstarted` and `ran` — and owns the limit match, the reset reading, the `Worker bound` cap and the without-progress decision. The message patterns are data in `adapters/harness/limit-lines.ts`, so the rule names no vendor and a second harness is an adapter entry. A reset is resolved to a wall-clock time in its IANA zone on the date of now, up to 120 s in the past reads as now rather than tomorrow, and every instant goes out as epoch seconds and UTC ISO text so no caller parses a date. A finished slice whose output quotes a limit line still answers `ran`. `EndingReasonSchema` gains `limited`, kept apart from `unstarted` because the repair differs: one asks for a prompt fix, the other asks for time. The bundle `board/plot-prompt-exit.mjs` joins the table to the rule for `plot-worker-loop.sh`, which wires it in a following slice.

<!--
plan: docs/plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md
bumps:
  skills:
    plot: patch
-->
