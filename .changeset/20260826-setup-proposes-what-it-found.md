---
"plot": minor
---

`/plot-board-setup` proposes the `Tracker` it inferred, and audits its host/CI
proposals against a Bitbucket/Jira repo.

`Tracker` appeared **zero times** in the skill — the exact key this sprint's Jira
backend reads, so a user could configure everything else and the inbox would
stay blank. Setup now reads `plot-detect-repo.sh` alongside `plot-board-probe.sh`
(neither script grows the other's field) and turns its `ticket_prefix` into a
proposal: a repeated prefix is strong evidence *for* a Jira tracker, so it
proposes `Tracker: jira` with the evidence named — *"found `QUACDS-*` in 6 of 80
commits"*.

The signal is **one-directional**, which is the whole design. Measured across 70
repos, 32 of 64 Bitbucket repos carried no prefix, so absence proves nothing: no
prefix *asks* the open question and never proposes `Tracker: none` from silence.
A wrong `Tracker` carries the Jenkins slug's danger — it sends `issue-list` to
the wrong system, which answers with an empty list the board renders as *you have
no tickets* — so unattended it refuses the key rather than guessing, except where
a prefix was actually found.

Also: where a repo carries both a `Jenkinsfile` and `.github/workflows/`, setup
now asks which runs the PRs, naming both signals, rather than tie-breaking on the
git host — a team on GitHub running Jenkins is common, and a silent wrong `CI:`
key points every build lookup at the wrong system. One signal proposes, two
signals ask.

<!--
bumps:
  skills:
    plot-board-setup: minor
-->
