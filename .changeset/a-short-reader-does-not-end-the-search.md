---
'plot': patch
---

`plot-deliverable-search.sh` no longer exits 141 when a term matches more lines than a pipe buffer holds. It limits printed lines with `awk 'NR<=n'`, which reads all input, instead of `head`, whose early exit sent SIGPIPE to the writer under `set -euo pipefail`. `plot-reconcile-scan.sh` reads its plan phase and sprint maps through a here-string, so a map larger than the pipe buffer cannot read a known plan as unknown.
