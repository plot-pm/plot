---
'plot': minor
---

`plot-dispatch.sh` refuses to spawn a brief session when the agent it would spawn cannot reach `plot-implement`, and names the install it read. `Brief command` asks a headless agent for `/plot-implement <slug>`; `plot-implement` is a skill, and a skill the running agent does not have resolves to nothing. That failed twice — 2026-09-02 and 2026-09-04, 33 bytes each, `Unknown command: /plot-implement` — because Plot was installed as a plugin at 1.2.0 carrying eight of twenty skills, scoped to a different repository, four months stale. The prompt's wording was never the defect, and the board's form would have failed the same way.

The check asks whether `<installPath>/skills/plot-implement/` exists rather than comparing versions: a lagging install that carries the skill works, and refusing it would demand an update nobody needs. It refuses BEFORE the spawn, since failing late produced two logs nobody read. It fails toward allowing — an unreadable or absent registry says the check could not be made and proceeds, because running Plot from a checkout with no plugin install is a supported shape. `no-implement-skill` is its own refusal word rather than an overload of `no-brief-command`: there the key is absent, here it is set and the skill is unreachable.

Plot installs nothing. The message reports what was read and names the operator action, the shape `plot-fleetctl.sh` uses for a `node` that is not `.nvmrc`'s major.

<!--
plan: docs/plans/2026-09-06-the-brief-command-invokes-a-skill.md
bumps:
  skills:
    plot-dispatch: minor
-->
