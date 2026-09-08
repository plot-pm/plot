# What the domain refuses does not happen

> `setSprintState` refuses an unrecognised state, a Must-less commitment and a skipped phase. It has zero production callers. On 2026-09-08 a master agent wrote `State: Planned` into a sprint file by hand, activated it with nine unreadable items, and every one of those three refusals sat in the domain, tested and exported, while none of them fired.

## Status

- **State:** Draft
- **Type:** infra
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches

## Changelog

- A lifecycle transition a master agent performs goes through the domain, so a rule the domain already states cannot be walked past by editing a file.

<!-- Board impact: the sprint header counted 0 members for an hour because the
     file was written by hand. This is that class of defect. -->

## Motivation

**Measured 2026-09-08.** `setSprintState` at `transitions/sprint.ts:205` names nine refusals. Three of them describe exactly what a master agent did that afternoon:

| what happened | the refusal that exists |
|---|---|
| wrote `State: Planned`, a word the lifecycle does not have | `state-unrecognised` — *"the four are Planning, Committed, Active, Closed"* |
| activated a sprint whose items nothing could parse | `commitment-empty` — *"only a Must is a promise"* |
| went from `Planned` straight to `Active` | `state-unreachable` |

**ITS ONLY CALLER IS ITS OWN TEST FILE.** Searched the tree: `setSprintState` appears in `packages/domain/test/transitions-sprint.test.ts` and nowhere else outside the package. It is exported from `index.ts`, fully tested, and dead.

**AND THE OTHER THREE DO NOT EXIST AT ALL.** `setPlanPhase`, `setAgentState` and `setBranchState` are absent — the phase writes live in `plot-deliver.sh` and `plot-approve.sh` as `sed` over a markdown line. So `deliverable` is asked 145 times and answers well; the *write* it authorises is then performed by a shell script that could have written anything.

**THE COST WAS THREE COMPOUNDING MISTAKES IN ONE SESSION.** The sprint file was written by hand instead of from `templates/sprint.md`, so its headings read `### Must` where the board parses `### Must Have`; the phase was set with `sed`; the symlink was made with `ln -s`. Each alone is harmless. Together they produced a sprint that looked active, carried a phase no rule admits, and counted zero of its nine items for an hour while a person asked what was wrong with the board.

**THIS IS THE `a-sprint-item-has-one-scorer` DEFECT, ONE LAYER UP.** That plan found `scoreItem` with no production caller while `plot-sprint-release.sh` computed the same thing in twelve lines of shell — and the two had already drifted. Here the shell computes nothing at all: it just writes, and the rule watches.

## What this is not

**Not a ban on shell scripts.** `docs/shell-and-domain.md` settled where the seam is: a script that runs once per operator command asks the domain; one that runs once per agent per pass may duplicate a rule, declared and held by a corpus test. A sprint start is the first kind.

**Not a claim that every write needs a transition.** A brief, a changeset, a note in a plan's Notes section — none is a lifecycle state, and none has a rule that could refuse it.

**Not new rules.** `setSprintState` is written and tested. What is missing is that anything calls it.

## Slices

### The sprint transitions are reachable from a command (Branch: feature/a-sprint-transition-is-performed)

`board/plot-sprint-state.mjs` exposes `setSprintState`, and `/plot-sprint`'s start, commit and close steps call it instead of describing the write.

**THE BUNDLE IS THE SEAM `a-shell-script-asks-the-domain` BUILT.** A sprint transition happens once per operator command, which is the case that plan measured at 34 ms for `node` and 39 ms for a shipped bundle — a cost a once-per-sprint action pays without noticing.

**A REFUSAL IS PRINTED, NOT SWALLOWED.** Each of the nine carries a sentence naming the gate; the command prints it and stops. A caller that reported *"could not start sprint"* would lose the part a person acts on.

**THE PHASE WORD COMES FROM THE SCHEMA.** `SprintStateSchema.options` is the list, so a fifth word cannot be invented by anyone — including whoever writes the next skill.

**Done when** `/plot-sprint <slug> start|commit|close` performs its transition through `setSprintState`, a refusal is printed with its sentence and nothing is written, `State: Planned` is refused by name, a sprint with no Must cannot be committed, and the skill's prose describes the call rather than the file edit.

### A master agent cannot write a lifecycle field by hand (Branch: infra/a-lifecycle-field-has-one-writer) <!-- waits: feature/a-sprint-transition-is-performed -->

A gate refuses a commit that edits a `State:` line outside the scripts that own it.

**IT WAITS FOR THE TRANSITION ABOVE**, because a gate that refuses the only available method is a gate that stops work.

**THE READING IS THE DIFF, AND THE OWNERS ARE A SHORT LIST.** `plot-approve.sh`, `plot-deliver.sh` and the new sprint command write these lines; a commit touching `- **State:**` in `docs/plans/` or `docs/sprints/` from anywhere else is the case this refuses. Measured 2026-09-08: three such edits in one session, all by hand, all by `sed`.

**IT IS A GATE BECAUSE THE RULE FAILED TODAY.** *Can you answer "did I complete this?" without doing the work?* For "did I use the transition", yes — and the answer was wrong three times in an afternoon, by the agent that wrote the rules.

**Done when** a commit editing a `State:` line outside the owning scripts is refused with the command that would have done it, the owning scripts pass, and a plan or sprint created from a template passes.

## Notes

### The instruction this came from — 2026-09-08

Stated twice, and the second is the sharper one:

> *"Alle Aktionen gehen durch die Domain."*
> *"Was mit der Domain nicht möglich ist kannst du nicht machen."*

The first is a routing rule and could be satisfied by calling the domain and ignoring the answer. **The second is the gate**: a refusal is not advice to weigh — it is the end of that action.

**And it is aimed at the right actor.** Every one of the three mistakes was made by the master agent, not by a dispatched worker; each was a hand edit that no reviewer saw because it was not a code change. The rules existed. Nothing asked them.
