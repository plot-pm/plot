---
'@plot-pm/board': patch
---

A continued agent gets its AgentMonitor and BuildMonitor. `POST /api/continue` and the registry's fresh-agent continuation now start both monitors for the desk with the environment the dispatch wrapper gives them, and the manifest records their pids. A continuation first stops the pair the manifest records, so a desk keeps one pair, and a monitor that does not start is named in `.plot-worker.log`. Before, a continued agent's CI wait read a findings file no process wrote and always ran out (#1255).
