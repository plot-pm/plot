---
'plot': patch
---

`skills/plot/scripts/README.md` lists all 58 shipped `.sh` scripts with their *kind* (launcher, readings, decision, orchestration), how often each *runs* (once per operator command, once per agent per pass, or as a hook on every tool call), and the JS entry that replaces it — empty today, since none has moved yet. The 13 scripts the table previously lacked, `plot-worker-loop.sh` among them, now have rows, so `check-helper-table.sh`'s `BASELINE` falls from 31 to 18. `docs/shell-and-domain.md` and `CLAUDE.md`'s "A Shell Script Asks The Domain" section state the target — a command an agent runs is a JS entry point, a `.sh` file that remains is a launcher — and the price: a new declared duplicate must remove an equal number of lines elsewhere in the same change, which `scripts/check-shell-lines.sh` enforces. The ranking the inventory defines names `plot-deliver.sh` (601 lines) as wave 4's script, confirming the plan's candidate.

<!--
plan: docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md
-->
