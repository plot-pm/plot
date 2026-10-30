---
'plot': patch
---

fleetd now answers a desk's own `PLOT-BLOCKED` question instead of only notifying a person. `unblockerDue` decides, per tick, whether an untagged marker on a `waiting` desk with no live fixer and no recorded outcome should start the `unblocker` role; `applyUnblockDecisions` runs that role, records its answer, and hands it to `continueOnDesk`, surfacing a `question-moved` refusal, a failed run, or a throw without stopping the rest of the pass. A marker now carries an `author: loop|fleetd` tag so fleetd never answers its own or the loop's terminal markers, and the question-escalation ladder stays silent while an answer-record row reads `started`, so a person is not paged while the unblocker's own run is live. The `unblocker` role prompt gains explicit hard rules: never ask the desk to edit a gate or CI workflow, never ask it to bypass review or merge/release, prefer the most reversible answer, and never answer "wait for a person."

<!--
plan: docs/plans/2026-10-29-the-fleet-answers-plot-blocked-questions.md
bumps:
  skills:
    plot: patch
-->
