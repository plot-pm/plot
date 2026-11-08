---
'plot': patch
---

The fleet package gains a process census harness for Linux CI: `parseStraceExecs` turns an `strace -f` log into one record per started program image (pid, parent pid, path, argv) and lists forks without an exec separately, `traceExecs` runs a command tree under `strace -f` and returns those records, and the census suite fails by name where `strace` is absent and skips with one line on macOS.

<!--
plan: docs/plans/2026-11-08-process-census-gate.md
-->
