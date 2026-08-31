---
'@plot-pm/board': patch
---

A test-launched board server now exits when nobody has asked it for anything in
five minutes, not only when its launcher dies. `exitWithParent` polls the
parent pid, so a launcher that is alive but hung leaves it satisfied forever —
measured with two vitest processes asleep at 0% CPU for 33 and 47 minutes,
holding a board server that dutifully checked its ppid every second and kept
running. Gated on the same `PLOT_EXIT_WITH_PARENT` variable, so an operator's
`pnpm board` is untouched.
