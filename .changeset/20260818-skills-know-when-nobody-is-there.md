---
"plot": minor
---

Skills declare what to do when nobody is there to answer

Fifteen skills told an agent to use `AskUserQuestion`. Under `claude -p` there
is no one to answer, and the plan behind this change assumed the run would hang
until the harness killed it.

**Measured first, as the plan required — and the assumption was wrong.** The
tool is not registered at all under `claude -p`: it is absent from the session's
tool list and from the deferred tools `ToolSearch` can load. Nothing waits.

The real failure is quieter and worse. The agent notices the tool is missing,
writes what it would have asked into its prose, and **exits 0** — so a CI job
reading `$?` sees success and a dispatcher sees a finished worker. The refusal
exists only in text nobody parses. That is this repo's recurring defect, an
unobserved thing reported as an observed one, arriving through the exit code.

So the design holds but its purpose changes: not to prevent a wait, but to make
the skipped question land somewhere a machine reads, and to make the outcome a
decision a skill author wrote down rather than one a model improvised well.

- `PLOT_UNATTENDED=1`, stated explicitly and never inferred from a missing TTY
- Each question site declares its own shape — proceed with the documented
  default, refuse, or report and stop cleanly
- Every skipped question is named in a greppable
  `PLOT-UNASKED: <question> — <shape> — <outcome>` line, with a count per run
- **Gates refuse in both modes.** The variable answers *may I ask?*, never
  *may I proceed?*

One shared reference (`skills/plot/docs/unattended.md`) with the shapes declared
inline at each question, rather than fifteen copies of an unattended clause: the
interaction line spread by copy, and copies are what drifted. A contract test
pins the reference, the links, the disclosure lines and the gates.

<!--
bumps:
  skills:
    plot: minor
    plot-approve: minor
    plot-deliver: minor
    plot-dispatch: minor
    plot-fleet: patch
    plot-idea: minor
    plot-implement: minor
    plot-init: minor
    plot-merge-queue: patch
    plot-reconcile: minor
    plot-reject: minor
    plot-release: minor
    plot-sprint: minor
    ralph-plot-sprint: minor
    challenge-the-plan: minor
-->
