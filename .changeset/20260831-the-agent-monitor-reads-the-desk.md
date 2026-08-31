---
'plot': minor
---

The AgentMonitor reads the desk instead of announcing that it reads nothing. It
now publishes four findings — `owes an answer`, `holds unlanded work`, `owes a
review`, `owes a gate` — on change rather than on every pass, so silence means a
healthy desk and a repeated finding is not mistaken for a new one. The host is
asked at most once per pass, and only after every cheaper reading has refused.

<!--
bumps:
  skills:
    plot: minor
-->
