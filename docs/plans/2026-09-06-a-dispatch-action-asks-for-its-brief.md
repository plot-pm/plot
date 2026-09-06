# A dispatch action asks for its brief

> `plot-dispatch.sh` asks the `Brief command` to write a missing brief. The board's auto-dispatch and its *Start work* button do not — they filter the branch out and go quiet. Three doors onto one act, and only one of them offers the step the other two need.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 4

## Changelog

- Every path that starts work offers to write the brief it requires, instead of silently declining to start.

<!-- Board impact: the Start work button and the auto-dispatch switch both gain
     a step. The board renders the asking and its outcome. -->

## Motivation

**A slice with no brief is not started.** `auto-dispatch.ts:911` states it and `findMissingBriefs` enforces it, reading `origin/main` rather than the filesystem so a lagging checkout cannot be wrong about main. That rule is right and this plan does not touch it.

**WHAT DIFFERS IS WHAT EACH DOOR DOES ABOUT IT.**

| door | brief missing → |
|---|---|
| `plot-dispatch.sh` | **asks the `Brief command`**, names the log, says to dispatch again once it lands |
| board auto-dispatch | filters the branch out (`auto-dispatch.ts:449`, `:494`), logs a skip |
| board *Start work* | **asks** — it posts to `/api/dispatch`, which spawns that same script |

**THE ASKING ARM IS BUILT AND CONFIGURED, AND IT HAS NEVER ONCE WORKED.** Both real invocations are on disk and both are failures — `.plot/brief-a-thinking-agent-has-a-quiet-stretch.log` (2026-09-02) and `.plot/brief-an-agent-knows-what-it-spent.log` (2026-09-04), **33 bytes each**, both reading `Unknown command: /plot-implement`. A person wrote both briefs afterwards.

`plot-implement` is a **skill**, not a slash command: `skills/plot-implement/SKILL.md` declares `name: plot-implement`, and `~/.claude/commands/` holds nothing by that name. The bare `/plot-implement` in the prompt resolves to nothing.

**The other three agent-runner keys carry the same shape** — `Idea command`, `Story command` and `Approve command` all name a bare `/plot-<name>` — and none has ever run on this estate, so no log disproves the same defect there. This plan fixes the one it can measure.

**The arm is built and configured.** `plot-dispatch.sh:492` spawns it detached with `PLOT_PLAN_SLUG` and `PLOT_BRIEF_BRANCH`; `Brief command` is set in this repo's `## Plot Config`. The board reaches none of it.

**MEASURED 2026-09-06, AND IT COST AN AFTERNOON.** Nine eligible slices had no brief. Auto-dispatch was **on**. It skipped all nine every pulse for hours, and eight agents sat idle while the board rendered the slices as startable. A person eventually wrote the briefs by hand.

**The board's log said so** — *"skipping branch(es) with no brief on origin/main (run /plot-implement first)"* — which is a good sentence in a place nobody was reading. **A skip nobody sees is the defect `a-refused-dispatch-asks-for-a-brief` already fixed once, for the shell.**

## What this is not

**Not a weakening of the brief gate.** No slice starts without a brief. The change is what happens instead of stopping.

**Not a second budget.** A brief session pushes to `main` where an agent pushes to its own branch, which argues for its own smaller cap. Rejected: `parallelAgents` is the fleet's budget and a brief session costs what an agent costs, so one budget governs both and a reader has one number to reason about. The blast radius is bounded by the cap and by the two off switches, not by a second limit nobody would remember to set.

**Not automatic brief acceptance.** The `Brief command` writes a brief; a person still reads it. The dispatch happens on a later pulse, once the brief is on `origin/main` — which is exactly `plot-dispatch.sh`'s existing shape: *"dispatch again once it lands; the gate reads <ref>."*

**Not a promise that a brief appears.** `plot-dispatch.sh:500` is explicit that the count measures the START and not the result — measured 2026-09-02, a `Brief command` that answered `Unknown command: /plot-implement` in 33 bytes still counted. The board must inherit that honesty, not paper over it.

**Not a fourth implementation.** The arm exists in the shell. The board should reach it, not re-derive it.

**Not a change to `Start work`.** Round 1 measured it: `isReadyToStart` tests `phase === 'Development' && started === false` and never consults the brief, so the button is already offered for an unbriefed slice, and `/api/dispatch` spawns `plot-dispatch.sh`, which already asks. The slice proposing to add that was deleted rather than kept as a no-op.

## Slices

### The brief command actually writes a brief (Branch: bug/the-brief-command-invokes-a-skill)

`plot-dispatch.sh`'s brief prompt invokes `plot-implement` in a form that resolves, and one real brief is written end to end.

**IT LEADS BECAUSE EVERYTHING BEHIND IT IS UNVERIFIABLE.** The arm has a measured 0% success rate over two attempts. Auto-dispatch calling it would fail the same way, on a 5 s pulse, and the first working test would be in production.

**THE FIX IS THE INVOCATION, NOT A SECOND WRITER.** `/plot-implement` step 4 owns brief authorship and must keep owning it — `plot-dispatch.sh:429` states why a script here would be a second writer that drifts. What changes is how the session is asked to reach that skill.

**AND THE SESSION MUST WRITE ONLY THE BRIEF, WHICH THE PROMPT ASKS FOR IN PROSE AND NOTHING ENFORCES.** `/plot-implement` is a six-step ceremony, not a brief writer: **step 3 creates the branches** the plan names and **step 5 records `Started:`**. Round 4 measured what gates them — `PLOT_UNATTENDED` appears three times in the skill and every one gates a QUESTION, not a write. So an unattended session asked for a brief may also push refs and amend the plan.

**A REF IS A CLAIM, AND THAT IS THE HARM.** `queue-reading.ts:23` says it in those words: a branch with a ref is out of the queue. A brief session creating the plan's branches would remove every one of them from the queue while no agent holds any — a plan that reads fully claimed and is being worked by nobody. That is worse than the silence this plan set out to fix, because the silence at least left the work visible.

**SO THE SCOPE IS PART OF THE FIX, NOT A NOTE ON IT.** Whether the invocation names a narrower entry point, or the skill learns a brief-only mode, or the prompt's request becomes something the skill can enforce, is this slice's design question. What it may not be is a longer sentence in a prompt: prose asking an agent not to do step 3 is a rule, and this repo's own test says a rule that matters gets a gate.

**DONE MEANS ONE REAL BRIEF, NOT A GREEN TEST.** The evidence is a brief on `origin/main` that this command wrote, for a branch that had none — the thing neither prior attempt produced. A log of 33 bytes is what failure looks like here, and it exits 0.

**Done when** the `Brief command` writes one real brief for one unbriefed branch and pushes it, its log shows the session doing work rather than an unknown-command line, **the run creates no branch and writes no `Started:` record**, and `plot-dispatch.sh` reports it.

### Auto-dispatch asks for the brief it is missing (Branch: feature/the-board-asks-for-a-brief)

Auto-dispatch invokes the `Brief command` for a branch it would otherwise skip, and reports what it started.

**IT IS THE ONE PATH THAT GOES QUIET.** Round 1 checked all three, and two of them were already right: `plot-dispatch.sh` asks, and `/api/dispatch` — which *Start work* posts to — spawns that same script, so the button already asks too. Only `auto-dispatch.ts:449` filters the branch out and logs a skip.

**IT ASKS AT MOST ONCE PER BRANCH, NOT ONCE PER PULSE.** The board pulses every 5 s and the command is a `claude -p` session of unknown length. An unguarded ask spawns a session every pulse for every unbriefed branch — with nine branches that is a fork bomb with a friendly name.

**THE IN-FLIGHT MARK CANNOT BE REUSED, AND ROUND 1 KILLED THAT PLAN.** `pruneInFlight` retires a mark when the pulse shows the branch claimed, merged, gone from every plan, or held by a live registry entry. **A brief lands as a file on `origin/main` and produces none of those** — `isStartable(b.state)` still answers true, so `stillPending` keeps the mark and the branch is charged against `parallelAgents` forever. Reusing it would leak the budget one slot per brief.

**SO THE ASK NEEDS ITS OWN MARK, RETIRED ON ITS OWN EVIDENCE:** the brief appearing on `origin/main`, which `findMissingBriefs` already reads every pulse. That reading is the retirement condition, and it is the only one that matches what the ask actually produces.

**IT IS BOUNDED BY THE SAME CAP AS A DISPATCH.** A brief-writing session costs what an agent costs. `parallelAgents` is the fleet's budget and asking must draw on it, or the cap stops meaning anything.

**THE ASK IS PER PLAN, NOT PER BRANCH, AND ROUND 2 FOUND THE MISMATCH.** The prompt is `/plot-implement <slug>` — one command about a whole plan — while the ask, the mark and the log are all keyed by branch (`plot-dispatch.sh:486` writes `.plot/brief-<branch>.log`). Measured 2026-09-06: `the-workflow-owns-the-word-phase` had **2** unbriefed branches and `every-element-is-a-domain-concept` had 1, so a per-branch ask would fire the same command twice against one plan, in two sessions, writing two logs.

**`PLOT_BRIEF_BRANCH` LOOKS LIKE THE ANSWER AND IS NOT.** `plot-dispatch.sh:493` exports it, and `/plot-implement` **names it zero times** — the branch reaches the session only as prose inside the prompt. So nothing mechanically scopes the session to one branch, and two sessions on one slug are two agents writing into the same plan's brief directory with no lock between them.

**SO THE MARK IS KEYED BY SLUG.** One ask per plan per pass, however many of its branches are unbriefed — which is also what the command actually does. A per-branch mark would be counting the wrong thing and paying for it twice.

**A SESSION IS BOUNDED, AND A PLAN THAT KEEPS FAILING IS HANDED TO A PERSON.** `startFreeAgent` bounds a start at 60 s; a brief session is spawned with `nohup` and waited on by nobody, so today nothing bounds it at all. It gains a bound — minutes, not the fleet's 8 h `Worker bound`, because a brief is not a slice — and **after a bounded number of failed asks the plan is marked as needing a person**, the shape the supervisor's `PLOT-BLOCKED` marker already has. Retiring the mark on expiry alone would ask forever against a command that cannot work, which is exactly the state this estate was in for four days.

**TWO OFF SWITCHES, AND THEY STOP DIFFERENT THINGS.** The auto-dispatch switch stops the asking live, because the asking is part of that loop. `Brief command: none` stops it for the project permanently — the shell already reads `none` as *we write them by hand*, and the board must honour the same answer rather than inventing a second way to say it.

**IT REPORTS THE START, NEVER THE OUTCOME**, and names the log — the property `plot-dispatch.sh:500` had to learn by measurement: a `Brief command` that answered `Unknown command: /plot-implement` in 33 bytes still counted as asked.

**Done when** auto-dispatch asks for a missing brief at most once per PLAN per pass, the ask draws on the agent cap, its mark retires when the brief appears on `origin/main` and not before, a session that exceeds its bound is reported, a plan whose asks keep failing is marked for a person rather than asked forever, `Brief command: none` and the auto-dispatch switch each stop it, and the board names the log.

## Notes

### Why the shell already does this — 2026-09-06

`a-refused-dispatch-asks-for-a-brief` is Released and it is this plan one door earlier: a dispatch that refused for a missing brief was a dead end, and the fix was to offer the step rather than report the wall. The board grew its own dispatch path afterwards and did not inherit the offer.

**That is the shape to expect wherever a second door appears** — and the argument for reaching the shell's arm rather than writing a third one.

### Round 1 — 2026-09-06

**Two of the three doors were already right, and the plan claimed all three were wrong.** Checking each against the code cut the plan in half and corrected the half that survived.

**`Start work` already asks.** `isReadyToStart` (`PlanCard.tsx:38`) tests `phase === 'Development' && started === false` and never reads the brief, so the button is offered for an unbriefed slice; `/api/dispatch` spawns `plot-dispatch.sh`, which asks the `Brief command` at `:492`. The slice proposing to add this was **deleted** — a slice whose Done-when the estate already satisfies is the seventh duplicate deliverable this week, and `a-plan-greps-for-its-own-deliverable` exists because of the first six.

**The surviving slice had a defect that would have leaked the budget.** It said to reuse the in-flight mark and *"retire it on the same evidence"*. `pruneInFlight` retires on claimed, merged, gone, or a live registry entry — **a brief on `origin/main` is none of those**, `isStartable` keeps answering true, and the mark would never drop. Every brief asked for would have cost a permanent slot against `parallelAgents`, silently shrinking the fleet.

**The retirement condition the ask actually needs is a reading the board already takes**: `findMissingBriefs` runs every pulse and answers exactly *did the brief appear*.

**What the round did not change:** the gate itself. No slice starts without a brief, and that was never in question.

### Round 2 — 2026-09-06

**The ask is keyed by branch and the command is keyed by plan.** `plot-dispatch.sh` asks with the prompt `/plot-implement <slug>` and logs to `.plot/brief-<branch>.log` — a per-plan command behind a per-branch key.

**Measured on today's own estate:** `the-workflow-owns-the-word-phase` carries 2 unbriefed branches, `every-element-is-a-domain-concept` 1. Under a per-branch ask the first would spawn **two `claude -p` sessions running the identical command**, against one plan, with no lock between them.

**`PLOT_BRIEF_BRANCH` is exported and never read.** `/plot-implement` names it zero times; the branch reaches the session only as prose in the prompt. So nothing scopes a session to one branch, and the duplicate is a genuine collision rather than a harmless repeat.

**The mark moves to the slug.** That is what the command's own granularity was all along, and it makes the ask cheaper as a side effect rather than as a compromise.

**What round 2 did not find:** any reason to doubt the retirement condition round 1 settled. `findMissingBriefs` reads per branch, and a slug-keyed mark retires when *every* branch of that plan is briefed — which is exactly when the command has finished its job.

### Round 3 — 2026-09-06

**The arm this plan builds on has never worked, and the logs were on disk the whole time.** `.plot/brief-*.log` holds exactly two files, 33 bytes each, both `Unknown command: /plot-implement` — 2026-09-02 and 2026-09-04. A person wrote both briefs afterwards, and this session wrote nine more by hand today without checking why the arm was silent.

`plot-implement` is a skill (`SKILL.md` declares `name: plot-implement`); `~/.claude/commands/` holds no such command. The prompt's bare `/plot-implement` resolves to nothing.

**So a slice was added ahead of everything else**, and its Done-when is one real brief on `origin/main` rather than a passing test. Building auto-dispatch on a 0%-success arm would have put the first working test in production, on a 5 s pulse.

**The other three agent-runner keys carry the same shape and no evidence either way.** `Idea command`, `Story command` and `Approve command` all name a bare `/plot-<name>`, and none has ever run here — `.plot/` holds no log for any of them. That is a suspicion, not a measurement, and it stays out of this plan.

**Three decisions the code could not settle, taken by a person:**

- **Bounded, and a plan that keeps failing goes to a person.** Retiring the mark on expiry alone asks forever against a command that cannot work — the state this estate was actually in for four days.
- **One budget, not two.** A separate cap for brief sessions is a second number to reason about; the two off switches bound the blast radius instead.
- **Both off switches.** The auto-dispatch toggle stops it live; `Brief command: none` stops it for the project, and the shell already reads `none` that way.

### Round 4 — 2026-09-06

**`/plot-implement` is not a brief writer.** It is six steps, and two of them write to the estate: step 3 creates the branches the plan names, step 5 records `Started:`. The prompt asks only for the brief, in prose, and nothing enforces it.

**`PLOT_UNATTENDED` does not help.** It appears three times in the skill and every one gates a *question* — which plan, what to do on drift — never a write. An unattended session runs steps 3 and 5 as written.

**A ref is a claim** (`queue-reading.ts:23`, in those words). A brief session creating a plan's branches takes every one of them out of the queue while no agent holds any: the plan reads fully claimed and nobody is working it. **Worse than the silence this plan exists to fix**, because silence left the work visible.

**Round 3 said the arm has never worked. Round 4 says that may have been luck.** Both failed invocations died at the unknown command — *before* reaching step 3. Fixing only the invocation, as round 3 scoped it, would have made the first successful run the first one to create branches nobody asked for.

**The scope is now part of slice 1's Done-when**, as a measurement — no branch created, no `Started:` written — rather than a sentence in a prompt. A prompt asking an agent to skip a step is a rule, and this repo gates what matters.
