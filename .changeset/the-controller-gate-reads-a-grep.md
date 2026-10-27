---
"plot": patch
---

The controller gate no longer refuses a read-only `grep`, `head`, `tail`, `wc`, `diff`, `cmp`, `stat`, `shasum`, `sha256sum`, `test`/`[`, or `git diff`/`show`/`log` whose operand names a controller-owned script, though the command runs nothing (#2706): `grep -n x skills/plot/scripts/plot-dispatch.sh` used to answer `plot-dispatch.sh is a controller-owned action` although it only reads the file. `isReadSegment` now delegates to the same reader predicate `isReader` already uses for a `for`-loop body, so the two reader sets cannot drift apart again. A reader segment still counts as a run when any word holds a command or process substitution (`$(…)`, a backtick, `<(…)` or `>(…)`), when it carries a leading `NAME=value` assignment or an `env` prefix, or when a `git` reader takes an option that runs or writes a program (`--ext-diff`, `--textconv`, `--output`, `-O…`, `--open-files-in-pager`) — each of those hid a real run behind an apparent read. The same predicate backs the merge-pin check, so `grep -n pr-merge skills/plot/scripts/plot-host.sh` no longer reads as an unpinned `plot-host` merge. `sed`, `awk` and `rg` stay refused on purpose, and a reader piped into a shell, redirected to a file, or shadowed by a function stays a known, pinned hole rather than a closed one.

<!--
plan: docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md
bumps:
  skills:
    plot: patch
-->
