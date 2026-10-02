---
'plot': patch
---

The worker's `idle` finding is judged from one reading of the desk, so no process has to hold a previous sample. The condition that needed two — the tree did not move between passes — is now `treeQuietSeconds`, seconds since the newest of HEAD's committer time and each dirty path's and its parent directory's mtime. That is a stronger statement than *unchanged across two passes 30 s apart*, and the filesystem had been recording it all along. The rule lives in `idleNow` and in `plot_worker_idle_now`, paired over all 864 combinations of its six readings by `packages/domain/corpus/sample.corpus.test.ts`. The desk root's own mtime is deliberately never read: the loop replaces `.plot-worker.*` records there, which moves it, so a root-level dirty path contributes its own mtime and not its parent — without that, `idle` could never fire on any desk the loop had written to. The tree reading uses `git status --porcelain -uall`, because default porcelain collapses a wholly new untracked directory to one line and a directory's mtime does not move when a file inside it is written; measured 2026-10-02, a directory aged 2000 s holding a file 1 s old read 2001 s quiet.

<!--
plan: docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md
bumps:
  skills:
    plot: patch
-->
