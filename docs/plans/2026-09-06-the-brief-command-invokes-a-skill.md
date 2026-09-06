# The brief command invokes a skill

> `Brief command` has run twice and failed twice, identically: 33 bytes reading `Unknown command: /plot-implement`. `plot-implement` is a skill, and the prompt opens with a bare slash command. The board's own runner uses a form that may work, and nobody has compared them.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- The shell's brief command reaches the skill it names, and one real brief proves it.

<!-- Board impact: none directly. The board has its own runner key; this fixes
     the shell's, which repositories without a board depend on. -->

## Motivation

**Both invocations are on disk and both are failures.** `.plot/brief-a-thinking-agent-has-a-quiet-stretch.log` (2026-09-02) and `.plot/brief-an-agent-knows-what-it-spent.log` (2026-09-04), **33 bytes each**, both `Unknown command: /plot-implement`. A person wrote both briefs afterwards.

**`plot-implement` is a SKILL.** `skills/plot-implement/SKILL.md` declares `name: plot-implement`; `~/.claude/commands/` holds nothing by that name. The prompt's leading `/plot-implement <slug> —` resolves to nothing.

**THE BOARD'S RUNNER USES A DIFFERENT FORM.** `composeImplementPrompt` (`implement.ts:114`) produces *"Run /plot-implement `<slug>` and follow it."* — an instruction to a `claude -p` agent rather than a command line. Whether that form works is **unmeasured**: `Implement command` was unset on this estate until 2026-09-06, so its route had never run.

**Both keys stay, and that is not duplication.** `plot-dispatch.sh` runs in repositories with no board and cannot read the board's key. What must not differ is the form of the invocation.

## What this is not

**Not a second brief writer.** `/plot-implement` step 4 owns brief authorship, and `plot-dispatch.sh:429` states why a script here would be a second writer that drifts. Only the invocation changes.

**Not a change to the board's runner.** If its form proves correct, the shell adopts it. If both are wrong, both change together.

## Slices

### The shell's brief prompt reaches the skill (Branch: bug/the-brief-command-invokes-a-skill)

`plot-dispatch.sh`'s brief prompt invokes `plot-implement` in a form that resolves, and one real brief is written end to end.

**THE SESSION MUST WRITE ONLY THE BRIEF, AND NOTHING ENFORCES THAT TODAY.** `/plot-implement` is six steps: **step 3 creates the branches** the plan names and **step 5 records `Started:`**. `PLOT_UNATTENDED` appears three times in the skill and every one gates a QUESTION, never a write.

**A REF IS A CLAIM, AND THAT IS THE HARM.** `queue-reading.ts:23` says it in those words. A brief session creating a plan's branches takes every one out of the queue while no agent holds any — a plan that reads fully claimed and is worked by nobody. **Worse than the silence it was called to fix**, because silence left the work visible.

**BOTH FAILURES DIED BEFORE STEP 3**, at the unknown command. So fixing only the invocation would make the first successful run the first to create branches nobody asked for. **The scope is part of the fix**, not a note on it: a longer sentence in a prompt is a rule, and this repo gates what matters.

**THE LOG MOVES ONTO `agentLogPath`, KEYED BY SLUG.** `.plot/brief-<branch>.log` is a bare path no board code knows, in a scheme nothing else uses, while `/plot-implement` prepares a plan rather than a branch. `agentLogPath(repoRoot, 'brief', slug, 'log')` puts it beside the dispatch log where the board's existing reader can find it.

**Done when** the `Brief command` writes one real brief for one unbriefed branch and pushes it, its log shows the session working rather than an unknown-command line, **the run creates no branch and writes no `Started:` record**, the log lives under `agentLogPath` keyed by slug, and a sandbox e2e with a stub `Brief command` asserts the wiring — invoked, scoped, no ref left behind.

## Notes

### Why a stub proves the wiring and a real run proves the rest — 2026-09-06

The stub asserts what a test can: that the command is invoked with the right prompt, that the session is scoped, that no ref appears. It cannot assert that a real `claude -p` reaches the skill, because the failure being fixed is precisely in that hand-off.

**So the Done-when names one real brief on `origin/main`** — the thing neither prior attempt produced. A 33-byte log is what failure looks like here, and it exits 0.
