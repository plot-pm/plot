---
'@plot-pm/board': minor
---

Agent logs live under the configured `Worktree root` instead of the repository's parent directory, with a path guard on `/api/dispatch-log` and a one-time move of existing logs.

The resolver reads the same key `plot-config.sh` documents and `plot-dispatch.sh`'s `resolve_wt_root()` reads, so a project that pointed its worktrees elsewhere gets its logs there too; a repository with no key keeps writing beside itself, because creating a `.worktrees/` so a log has somewhere to go invents a directory nobody asked for. The migration is bounded to the names Plot wrote, never deletes, runs once, and cannot fail a dispatch.
