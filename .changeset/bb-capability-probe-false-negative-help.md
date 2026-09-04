---
'plot': patch
---

Plot reads PRs on any `bb` whose help text mentions `--json` in prose. The capability probe asked a text heuristic before the exit code, so bb 1.9.0's own sentence documenting that the flag is cheap — "a bare `--json`, costs nothing extra" — matched `--json.*not` and rejected a bb that works. The probe now trusts the exit code of the help call, matches only what a CLI prints when it rejects a flag, and names what it tested rather than guessing who shipped the binary.

<!--
bumps:
  plot: patch
-->
