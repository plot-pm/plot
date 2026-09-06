# The brief command invokes a skill

> `Brief command` has run twice and failed twice, identically: 33 bytes reading `Unknown command: /plot-implement`. `plot-implement` is a skill, and the prompt opens with a bare slash command. The board's own runner uses a form that may work, and nobody has compared them.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The shell's brief command reaches the skill it names, and one real brief proves it.

<!-- Board impact: none directly. The board has its own runner key; this fixes
     the shell's, which repositories without a board depend on. -->

## Motivation

**Both invocations are on disk and both are failures.** `.plot/brief-a-thinking-agent-has-a-quiet-stretch.log` (2026-09-02) and `.plot/brief-an-agent-knows-what-it-spent.log` (2026-09-04), **33 bytes each**, both `Unknown command: /plot-implement`. A person wrote both briefs afterwards.

**`plot-implement` is a SKILL.** `skills/plot-implement/SKILL.md` declares `name: plot-implement`; `~/.claude/commands/` holds nothing by that name. The prompt's leading `/plot-implement <slug> —` resolves to nothing.

**THE PROMPT FORM IS NOT THE DEFECT, AND ROUND 1 MEASURED IT.** The plan opened blaming the shell's leading `/plot-implement <slug> —` against the board's *"Run /plot-implement `<slug>` and follow it."* **Both name a skill the running agent does not have.**

Plot is installed as a plugin, and the installed copy is **1.2.0** against this repo's **2.13.0**. Its `skills/` directory holds **eight**:

```
plot  plot-approve  plot-deliver  plot-idea
plot-reject  plot-release  plot-sprint  ralph-plot-sprint
```

**`plot-implement` is not among them.** Nor are `plot-dispatch`, `plot-fleet`, `plot-pulse`, `plot-reconcile`, `plot-board`, `plot-init`, `plot-merge-queue`, `plot-reslice` — **twelve skills this repo has and the installed plugin does not.**

**So `Unknown command: /plot-implement` was literally true**, and it would have been true of the board's form as well. `Implement command` being unset until 2026-09-06 is not why its route never ran successfully; it would have failed the same way.

**Both keys stay, and that is not duplication.** `plot-dispatch.sh` runs in repositories with no board and cannot read the board's key. What must not differ is the form of the invocation.

## What this is not

**Not a second brief writer.** `/plot-implement` step 4 owns brief authorship, and `plot-dispatch.sh:429` states why a script here would be a second writer that drifts. Only the invocation changes.

**Not a change to the board's runner.** If its form proves correct, the shell adopts it. If both are wrong, both change together.

## Slices

### The brief command reaches a skill the agent has (Branch: bug/the-brief-command-invokes-a-skill)

The brief prompt invokes `plot-implement` in a way that resolves for the agent that runs it, and one real brief is written end to end.

**THE FIX IS NOT A WORDING CHANGE.** A prompt naming a skill the agent does not have fails whatever its phrasing. What must be settled is how a dispatched session reaches this repository's skills at all: the installed plugin is twelve skills behind, and `plot-dispatch.sh` runs from the repo while the agent it spawns loads its skills from elsewhere.

**PLOT CANNOT INSTALL ITS OWN PLUGIN, SO IT REFUSES INSTEAD.** Updating an install is an operator action on a machine. What a script can do is decline to spawn a session that will fail, and name the repair — the shape `/api/dispatch` already uses for `no-implement-command`, and `plot-fleetctl.sh` uses for a `node` that is not `.nvmrc`'s major.

**THE READING IS AVAILABLE AND IT IS SPECIFIC.** `~/.claude/plugins/installed_plugins.json` carries, per plugin: `scope`, `projectPath`, `installPath`, `version` and `installedAt`. Measured 2026-09-06 for `plot@plot-marketplace`:

```
scope        project
projectPath  /Users/jwloka/Quatico/CDS/cpq-cds-develop   ← a DIFFERENT repository
installPath  ~/.claude/plugins/cache/plot-marketplace/plot/1.2.0
version      1.2.0                                        ← repo is 2.13.0
installedAt  2026-05-08                                   ← four months stale
```

**The install is scoped to another project entirely**, which is why nothing here noticed: a plugin installed for a different repository is not absent, it is elsewhere, and no error names that.

**THE CHECK ASKS WHETHER THE SKILL IS THERE, NOT WHETHER THE VERSION MATCHES.** A version comparison would refuse a working install that happens to lag, and demand an update nobody needs. What breaks a brief session is one missing directory, so that is what is read: does `<installPath>/skills/plot-implement/` exist.

**IT REFUSES BEFORE SPAWNING, NEVER AFTER.** The measured cost of failing late is two 33-byte logs, four days apart, that nobody read — and this session writing nine briefs by hand without asking why the arm was silent. A refusal that arrives before the session starts is read by whoever ran the dispatch.

**THE SESSION MUST WRITE ONLY THE BRIEF, AND NOTHING ENFORCES THAT TODAY.** `/plot-implement` is six steps: **step 3 creates the branches** the plan names and **step 5 records `Started:`**. `PLOT_UNATTENDED` appears three times in the skill and every one gates a QUESTION, never a write.

**A REF IS A CLAIM, AND THAT IS THE HARM.** `queue-reading.ts:23` says it in those words. A brief session creating a plan's branches takes every one out of the queue while no agent holds any — a plan that reads fully claimed and is worked by nobody. **Worse than the silence it was called to fix**, because silence left the work visible.

**BOTH FAILURES DIED BEFORE STEP 3**, at the unknown command. So fixing only the invocation would make the first successful run the first to create branches nobody asked for. **The scope is part of the fix**, not a note on it: a longer sentence in a prompt is a rule, and this repo gates what matters.

**THE LOG MOVES ONTO `agentLogPath`, KEYED BY SLUG.** `.plot/brief-<branch>.log` is a bare path no board code knows, in a scheme nothing else uses, while `/plot-implement` prepares a plan rather than a branch. `agentLogPath(repoRoot, 'brief', slug, 'log')` puts it beside the dispatch log where the board's existing reader can find it.

**Done when** a dispatch whose agent cannot reach `plot-implement` refuses before spawning and names the install it read, the `Brief command` writes one real brief for one unbriefed branch and pushes it once the skill is reachable, its log shows the session working rather than an unknown-command line, **the run creates no branch and writes no `Started:` record**, the log lives under `agentLogPath` keyed by slug, and a sandbox e2e with a stub `Brief command` asserts the wiring — invoked, scoped, no ref left behind.

## Notes

### Why a stub proves the wiring and a real run proves the rest — 2026-09-06

The stub asserts what a test can: that the command is invoked with the right prompt, that the session is scoped, that no ref appears. It cannot assert that a real `claude -p` reaches the skill, because the failure being fixed is precisely in that hand-off.

**So the Done-when names one real brief on `origin/main`** — the thing neither prior attempt produced. A 33-byte log is what failure looks like here, and it exits 0.

### Round 1 — 2026-09-06

**The prompt form was never the defect.** The plan opened comparing the shell's leading `/plot-implement <slug> —` against the board's *"Run /plot-implement `<slug>` and follow it."* — and both name a skill the running agent does not have.

**Plot is installed as a plugin at 1.2.0 against this repo's 2.13.0**, and its `skills/` holds eight: `plot`, `plot-approve`, `plot-deliver`, `plot-idea`, `plot-reject`, `plot-release`, `plot-sprint`, `ralph-plot-sprint`. **Twelve are missing**, `plot-implement` among them — and with it `plot-dispatch`, `plot-fleet`, `plot-pulse`, `plot-reconcile`, `plot-board`, `plot-init`, `plot-merge-queue`, `plot-reslice`.

`Unknown command: /plot-implement` was **literally true**, and the board's form would have failed identically. `Implement command` being unset is not why that route never succeeded.

**And the install is scoped to a different repository** — `projectPath: /Users/jwloka/Quatico/CDS/cpq-cds-develop`, installed 2026-05-08. A plugin installed elsewhere is not absent, it is somewhere else, and nothing on this estate says so.

**So the deliverable changed from a wording fix to a refusal.** Plot cannot install its own plugin; it can decline to spawn a session that will fail, and name what it read. The check asks whether the skill directory exists rather than comparing versions — a lagging install that still carries the skill works, and refusing it would demand an update nobody needs.
