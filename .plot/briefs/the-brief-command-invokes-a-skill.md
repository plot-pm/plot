## Implementation brief — the-brief-command-invokes-a-skill (slice: The brief command reaches a skill the agent has)

- **Plan (canonical):** `docs/plans/2026-09-06-the-brief-command-invokes-a-skill.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/the-brief-command-invokes-a-skill` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

## What this delivers

A dispatch refuses to spawn a brief session when the agent cannot reach `plot-implement`, and names what it read.

**THE PROMPT WORDING IS NOT THE FIX, AND ROUND 1 SETTLED THAT.** The plan opened blaming the shell's leading `/plot-implement <slug> —` against the board's *"Run /plot-implement `<slug>` and follow it."* **Both name a skill the running agent does not have.** Do not rewrite either prompt as this slice's deliverable.

## The measurement

Plot is installed as a plugin at **1.2.0**; this repo is **2.13.0**. The installed `skills/` holds eight:

```
plot  plot-approve  plot-deliver  plot-idea
plot-reject  plot-release  plot-sprint  ralph-plot-sprint
```

**Twelve are missing**, `plot-implement` among them — with `plot-dispatch`, `plot-fleet`, `plot-pulse`, `plot-reconcile`, `plot-board`, `plot-init`, `plot-merge-queue`, `plot-reslice`.

So `Unknown command: /plot-implement` was **literally true** in both 33-byte logs (2026-09-02, 2026-09-04).

## What to read

`~/.claude/plugins/installed_plugins.json`, under `plugins`, carries per entry:

```
scope        project
projectPath  /Users/jwloka/Quatico/CDS/cpq-cds-develop   ← a DIFFERENT repository
installPath  ~/.claude/plugins/cache/plot-marketplace/plot/1.2.0
version      1.2.0
installedAt  2026-05-08
```

**The install being scoped to another project is why four months passed unnoticed** — a plugin installed elsewhere is not absent, it is somewhere else, and nothing named that.

## The check

**IT ASKS WHETHER THE SKILL DIRECTORY EXISTS, NOT WHETHER THE VERSION MATCHES.** `<installPath>/skills/plot-implement/`. A lagging install that still carries the skill works, and a version comparison would refuse it and demand an update nobody needs.

**IT REFUSES BEFORE SPAWNING, NEVER AFTER.** Failing late cost two logs nobody read and a session writing nine briefs by hand without asking why the arm was silent. The refusal is read by whoever ran the dispatch.

**IT NAMES THE REPAIR, WHICH IS AN OPERATOR ACTION.** Plot cannot install its own plugin. The message says what was read and what to do — the shape `plot-fleetctl.sh:306` uses for a wrong `node` major (*"node: <bin> (major 26, pinned 24)"*) and `/api/dispatch` uses for `no-implement-command`.

**IT FAILS TOWARD ALLOWING.** An unreadable or absent `installed_plugins.json` means *cannot verify*, not *broken*: a project running Plot from a checkout with no plugin install at all is a supported shape, and refusing it would break dispatch for everyone who never installed the plugin. **Say the check could not be made, and proceed.**

**THE REFUSAL WORD JOINS THE EXISTING SET.** `brief_command()` at `plot-dispatch.sh:441` already answers `no-brief-command` when the key is absent. This is a different refusal — the key is set and the skill is unreachable — so it gets its own word rather than overloading that one.

## Done when

- a dispatch whose agent cannot reach `plot-implement` refuses **before** spawning and names the install it read
- the check reads the skill directory, not the version
- an unreadable or absent plugin registry allows and says it could not verify
- the refusal names a repair an operator can perform
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not rewrite the brief prompt as the fix.** Round 1 disproved the wording theory; both forms fail identically.
- **Do not compare versions.** The question is whether the skill is there.
- **Do not refuse when the registry cannot be read.** Running Plot from a checkout without the plugin is supported.
- **Do not try to install or update the plugin.** That is the operator's action; this names it.
- **Do not overload `no-brief-command`.** A set key with an unreachable skill is a different state.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
