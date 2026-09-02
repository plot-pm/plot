---
'plot': minor
---

Measure how long a working agent stays quiet. `plot-quiet-stretch` reads dispatched sessions' transcripts and reports the distribution of gaps between runtime lines, split by whether the agent was waiting on the model or on a command it started. First run over 23 sessions: 37 stretches at or over the monitor's 30 s window, in 9 of them — and 28 of those 37 were waiting on a subprocess rather than thinking.
