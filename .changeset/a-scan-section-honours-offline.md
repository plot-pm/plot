---
'plot': patch
---

`plot-reconcile-scan.sh --offline` no longer calls the git host. The scan's header promises "no git-host network call" and section 2 honoured it, but section 6 carried no `PR_SOURCE` test at all between its loop and its per-plan `pr-state` call — so a scan told to stay local asked the host once per delivered plan. Reported on a repository with 82 delivered plans: about eleven minutes on a network the operator asked it to leave alone, against the pulse's 90 s budget, killed at `exit=124` still inside the section. What the flag gives up is a CORRECT answer rather than a broken one — offline output was byte-identical to online — so the section now prints a note naming how many delivered plans went unresolved, because an empty section reads as "nothing to report" and this section exists precisely so that "cannot tell" and "nothing wrong" cannot look the same. The guard sits below the `no PR annotation` arm, which answers from the plan file and costs no network: a flag that exists to avoid a host call must not suppress a finding that needs none. The banner names section 6 the way its absent and failed arms already name section 3, and an online scan's output is unchanged, pinned by a synthesized three-plan fixture that makes 3 calls online and 0 under each flag — synthesized because this estate's two delivered plans are both `docs`/`infra` and never reach the call, so a test pointed at the real plan directory would have measured nothing.

<!--
plan: docs/plans/2026-09-17-a-scan-section-honours-offline.md
bumps:
  skills:
    plot: patch
-->
