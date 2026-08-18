---
"plot": patch
---

<!--
bumps:
  skills:
    plot: patch
-->

plot-fleet: the pulse names the ref it read

`plot-fleet-scan.sh` derived every fact from `origin/$MAIN` but built its
banner from local `HEAD`. On `main` right after a fetch the two agree, which
is why it survived — the common case made it look correct.

Measured 2026-08-18, standing on a feature branch:

    scan header: plot-fleet pulse — 91a9a60 on origin/main
    local HEAD:  91a9a60
    origin/main: ee199aa

The sentence was false in the only part a reader uses, and the same value
travelled in `--json` as `head`, so every consumer — the board's Agents tab
included — inherited it.

The banner now names `origin/$MAIN`, and adds one clause when the checkout
differs: `(not your checkout <sha>, N behind)`. The clause points at the
report, not the tree — an operator told their checkout is behind still has
no reason to doubt the numbers underneath it.

`--json` gains `read_ref` and `local_head`. `head` remains as an alias for
`local_head` for one release; the board reads it today and must not break.

An unresolvable `origin/$MAIN` (no remote, fresh clone) reports `unknown`
rather than falling back to `HEAD` — that fallback would reintroduce this
bug in the one case where nothing can catch it, and `unknown` gets
investigated in seconds where a real-looking SHA gets believed.
