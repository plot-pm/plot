---
'plot': patch
---

A component needing the default branch repairs an unresolvable `origin/HEAD` rather than refusing. Measured twice on 2026-09-04, hours apart: the symref pointed at `origin/plot-corpus-pin`, a branch that does not exist on the remote, and `plot-dispatch.sh` refused every dispatch. `git remote set-head origin --auto` fixed it both times in under a second.

The check belongs where the symref is read, because the failure is invisible to every reader: `git symbolic-ref --short refs/remotes/origin/HEAD` on a corrupt symref exits 0 and prints a plausible branch name. Ten scripts read it that way and none can tell that answer from a good one — only the `rev-parse` downstream fails, in a component that has already built `origin/<main>` out of it.

`plot-default-branch.sh` is sourced by `plot-dispatch.sh`, `plot-fleet-scan.sh` and `plot-reconcile-scan.sh`. It names both refs when it repairs, so a recurring corruption stays visible in a log rather than silently patched. It does **not** repair a symref that resolves — `--auto` asks the remote and overwrites whatever it finds, so a clone deliberately pointing elsewhere would be overruled — and an absent symref is a fresh clone rather than a corruption.

The reconcile scan's own self-heal could not see this: it ran `set-head` only when the symref was **unset**, and a symref naming a deleted branch is not unset.

<!--
plan: docs/plans/2026-09-04-a-ref-is-not-a-claim.md
bumps:
  skills:
    plot: patch
-->
