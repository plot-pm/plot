---
'@plot-pm/board': patch
---

fix(@plot-pm/board): the registry lives where the dispatcher writes it

`AGENT_MANIFEST_DIR = '.plot/agents'` is repo-relative and `.plot/agents/` is
gitignored, so the manifest directory is per-worktree. A board served from a
worktree the dispatcher never wrote to read an empty directory and synthesized
the whole fleet with `session: ''` — so `BrokenAgentMenu`'s `if (!agent.session)`
guard fired for every row and no agent could offer *Drop this agent*.

The registry now resolves its manifest directory through `plot-config.sh` (the
`Agent registry` key), defaulting to `.plot/agents` so a single-checkout project
is unaffected. A project whose board runs outside the dispatcher's checkout
points the key at a shared location and the board finds the registry wherever it
was started from. The synthesis path stays — a hand-made worktree with no
manifest is still listed with `session: ''`.

<!--
bumps:
  skills:
    plot: patch
-->
