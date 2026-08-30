---
'plot': patch
---

The fleet scan says when it could not ask the host, instead of reporting a guess as an answer.

`plot-host.sh pr-list` collapsed three outcomes into one: an empty list meaning
*the host answered and there are none*, and a failed question, both exited 0 with
empty stdout. A caller could not tell them apart, so a host that refused every
call read as a repository with no merged PRs.

**Measured 2026-08-30:** a merged branch read `open` and was counted among the
unfinished under `merge_detect=pr-merge` — a summary field that reads as *asked
and answered* — while the host had in fact refused every call.

`pr-list` now exits **5** for a rate limit (primary or secondary) and **3** for
any other failure, both with empty stdout, keeping *the host said none* apart
from *the host did not say*. The two failure codes are separate because they ask
for different responses: 5 says wait, 3 says look. An unrecognised error is never
given the more specific name, and the adapter never retries — whether to wait is
the caller's decision, and a board on a 5s cadence, a scan inside a 90s budget
and a person at a terminal want three different answers.

The scan's summary gains `host=`: `ok` (the list arrived — an **empty** list is
`ok`), `throttled`, `failed`, or `unasked` (no host, or `--offline` — a question
never put is not one that went unanswered). Where `host` is `throttled` or
`failed`, a branch with no ref reads `unknown` rather than `open`.

Verified: `host.test.mjs` 125/125, with the three outcomes asserted apart.

<!--
bumps:
  skills:
    plot: patch
-->
