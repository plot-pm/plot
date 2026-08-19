---
"plot": patch
---

plot: the two paths that launch unattended agents say so

Wave 1 (#230) taught fifteen skills what to do when nobody can answer a
question, and documented it once in `skills/plot/docs/unattended.md`. **Nothing
set the variable.** This repo's own `Worker command` did not, and neither did
`ralph-plot-sprint`'s loop — so every dispatched worker and every sprint
iteration ran as if a person were watching, and the behaviour wave 1 built was
reachable only by an operator who exported it by hand.

What stood in for it was brief wording — *"if you must stop and ask, write
PLOT-BLOCKED"* — which is a rule an agent can rationalise around rather than a
condition it cannot meet. Both launch paths now set `PLOT_UNATTENDED=1`.

**The failure this closes is not a hang, and the distinction changes the test.**
Wave 1 measured what actually happens under `claude -p`: `AskUserQuestion` is
not registered at all. The agent notices, writes what it would have asked into
its prose, and **exits 0**. So a worker launched without the variable does not
wait and does not fail — it improvises and reports success, which a caller
reading `$?` cannot tell from a finished job. There is no runtime symptom to
assert against, which is why the tests assert the variable's *arrival* rather
than any behaviour downstream of it.

**Asserted from the launch path, not from the prose.** `test/e2e/unattended-launch.test.mjs`
dispatches a real worker whose `Worker command` is a recorder — it dumps the
environment it was handed — and reads `PLOT_UNATTENDED=1` out of that dump. The
indirection is the point: two transforms sit between the text a human edits and
the process that runs. `plot-config.sh` rewrites the value it parses (it strips
backticks and parenthetical prose), and `plot-dispatch.sh` re-wraps the result
in `sh -c`. Neither is visible to a reader of `CLAUDE.md`, and a grep of that
file would have passed while the variable was eaten in transit.

**A negative control ships beside it.** The same launch path with no prefix must
yield a worker with no `PLOT_UNATTENDED` at all. Without that control the first
test would stay green for a repo that never set the variable, proving only that
`sh -c` propagates an assignment. It also pins a design decision: dispatch
injects nothing of its own. The variable belongs to a repo's `Worker command`,
because a repo that never runs Plot unattended must see no change at all
(Principle 4) — and `plot-dispatch.sh` hardcodes no agent tooling (Principle 5).
Setting it in the script would have been one line and would have made every
adopting repo unattended without being asked.

**`ralph-sprint.sh` exports it once rather than prefixing each call.** The loop
has three call sites — the iteration, the wrap-up, and whatever
`$RALPH_SPRINT_CLAUDE` expands to — and a fourth added later would silently miss
a per-invocation prefix. It sits beside the existing `export CLAUDE_NTFY_SKIP=1`,
which is the same kind of statement about the same absent human. A test asserts
the export precedes the first invocation, since an export below a call site
covers nothing.

**The one rule is asserted, not asserted-about.** `PLOT_UNATTENDED=1` never
converts a gate into a pass, so the suite runs the real phase gate against a
Draft plan twice — variable set, then unset — and requires the same refusal
both times. The attended run is checked first as a control: if the gate did not
fire there, the comparison would pass for the wrong reason. The variable answers
*may I ask?*, never *may I proceed?*, and its power has to stay strictly smaller
than the operator's precisely because it is set where supervision is thinnest.

**What deliberately did not change.** The skills are untouched — wave 1 owns
what happens when the variable is set, and this wave supplies only the signal.
The `PLOT-BLOCKED` marker instruction stays in the `Worker command`, and a test
pins it there: the two answer different situations. `PLOT_UNATTENDED` says
*nobody can answer, take your documented path*; the marker says *I stopped
anyway, and here is why*. A worker that hits something genuinely undecidable
still needs the marker, and `plot-worker-state.sh` reads it to report `waiting`.
No path a person actually watches sets the variable.

<!--
bumps:
  skills:
    ralph-plot-sprint: minor
-->

`ralph-plot-sprint` bumps because the skill ships `ralph-sprint.sh`, whose loop
now declares itself unattended. No other skill bumps: the `Worker command` lives
in this repo's `CLAUDE.md`, which is adopting-project configuration rather than
skill content, and the fifteen skills that read the variable were shipped by
wave 1 unchanged.
