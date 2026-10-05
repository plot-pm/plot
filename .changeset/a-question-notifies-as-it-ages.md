---
'@plot-pm/board': minor
---

A desk's unanswered question now notifies a person once per configured age — fixing the failure measured 2026-10-05 where a question asked at 13:36 sat unanswered until 18:20 with `person=0` on every one of 10,521 ticks, because nothing read a question's age or told anyone. `questionEscalation` reads the marker's age against the `Question escalation` config (default `15m, 1h, 4h`) and the rungs already recorded for that exact marker, and answers the highest rung reached and whether it is new; the registry tick calls it for every desk holding a marker, after `supervise`, whatever the agent's loop is doing. `Question escalation: none` turns notification off. A new rung sends through the `Notifier` port: the `Notify command` runs through `sh -c` like `Worker command`, with the message only in `PLOT_NOTIFY_MESSAGE`, and `notifierNone` answers for a repository with no `Notify command`. The daemon reads `Notify command` each time it notifies, so adding one needs no restart. Each reached rung is recorded once in `.plot/state/escalations.tsv`, so a repeat tick never resends it; a failed send is retried at the next rung rather than every minute.

<!--
plan: docs/plans/2026-10-05-an-unanswered-question-escalates.md
-->
