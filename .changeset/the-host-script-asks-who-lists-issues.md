---
'plot': patch
---

`plot-host.sh issue-list` and `issue-view` ask who lists a repository's issues instead of assuming its git host does. Both ops tested the `Tracker` scheme for `jira` and sent every other scheme to the git host, so `PLOT_HOST=github PLOT_TRACKER=linear issue-list` exited 0 having called `gh issue list`: a repository tracking in Linear was shown GitHub's issues under Linear's name. A declared tracker no connector lists now exits 4 — the code both ops already document as *this host cannot be asked at all* — with no host call spent, and `Tracker: github-issues` exits 4 on a Bitbucket repository, naming the host it needs. An entry that cannot be asked exits 1 and never falls through to the git host. A repository that declared no tracker still asks its git host, and `Tracker: jira` still takes the Jira arm. A repository declaring `Tracker: plot` on GitHub loses its open-issue list here, as it already did on the board.

<!--
plan: docs/plans/2026-10-01-the-issue-ops-ask-who-answers.md
bumps:
  skills:
    plot: patch
-->
