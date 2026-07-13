---
"plot": patch
---

Support a project-local plan-template override through the existing config
mechanism: a `Plan template` key in `## Plot Config`. `/plot-idea` resolves the
template with `plot-config.sh get "Plan template" skills/plot/templates/plan.md`
— a project that declares `Plan template:` (a repo-root-relative path) uses its
own template; otherwise the shipped template is used. Reuses `plot-config.sh`
(plot's one adopter-config reader) rather than adding a bespoke resolver, so the
shipped plan template stays generic and projects opt in explicitly.

<!--
bumps:
  skills:
    plot: patch
    plot-idea: minor
-->
