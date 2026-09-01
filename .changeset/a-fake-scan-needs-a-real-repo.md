---
'@plot-pm/board': patch
---

The streaming-scan fixture initialises a git repository, so its three assertions on `fleet.error` stop depending on a race. `refresh()` asks git as well as the scan, and the fixture's bare temp directory is not a repository — `git for-each-ref` failed there and its stderr became the error the assertions read.
