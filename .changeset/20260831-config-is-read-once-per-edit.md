---
'@plot-pm/board': patch
---

`readConfig` caches its answers, keyed on the mtimes of `CLAUDE.md` and
`AGENTS.md`. Each miss spawns `bash plot-config.sh` synchronously — measured at
58 ms, called five times per `/api/board` — so a board answered 318 ms of
blocking spawns to read five lines from a file that changes twice a day. Keyed
on the files rather than a clock, so editing `## Plot Config` and reloading
shows the new value immediately.
