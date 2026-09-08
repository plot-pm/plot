# The master agent uses the controllers

> `setSprintState` refuses an unrecognised state, a Must-less commitment and a skipped phase. It has zero production callers. On 2026-09-08 a master agent wrote `State: Planned` into a sprint file by hand, activated it with nine unreadable items, and every one of those three refusals sat in the domain, tested and exported, while none of them fired.

## Status

- **State:** Draft
- **Type:** infra
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- A lifecycle action a master agent performs goes through its controller, so a refusal the domain already states cannot be walked past by editing a file.

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

**AND THE SPRINT IS ONE OF FOUR.** Measured over the same session, against the nine controller endpoints the board already exposes — `dispatch`, `approve`, `deliver`, `idea`, `implement`, `drop`, `reslice`, `commission`, `continue`:

| the action | how it was done | the controller that existed |
|---|---|---|
| activate a sprint | `sed` + `ln -s` | `setSprintState` |
| approve four plans | `python re.sub` on `State:` | the `approve` endpoint |
| dispatch slices | `plot-dispatch.sh` directly | the `dispatch` endpoint |
| deliver a plan | `plot-deliver.sh` directly | the `deliver` endpoint |
| open three PRs | `gh pr create` | **none — that is a finding** |

**Four of five had a controller and none was used.** Calling the script a controller wraps is not the same as calling the controller: the endpoint is where a refusal lives, and the script is what runs after it passed.

**AND THE ENDPOINTS ARE NOT ALIKE, WHICH THIS PLAN'S FIRST DRAFT TREATED AS IF THEY WERE.** Measured 2026-09-08, per endpoint:

| endpoint | rule calls before it spawns |
|---|---|
| `deliver` | **16** — `deliverable` and the branch-state rules |
| `approve` | **0** — it spawns `plot-approve.sh` and nothing else |
| `dispatch` | **0** |

**An endpoint that only spawns is a shell, not a controller.** It does not move the decision into the domain; it puts HTTP in front of the same script and makes the routing look done. So *"has an endpoint"* is the wrong condition, and this plan does not use it.

**AND THE SCRIPTS ALREADY REFUSE, WHICH CHANGES THE DIAGNOSIS.** `plot-approve.sh:81` refuses a plan whose phase is not `draft`, a `Review:` that is not `pr`, and a PR that is draft, closed **or absent**. The four plans approved by hand that afternoon had their plan-PR merged already — **the script would have refused every one of them.**

**So the failure was not a missing rule. It was that nothing was called.** `sed`, `python re.sub`, `ln -s`: no endpoint, no script, no rule — an editor on a markdown line. There was no invocation to check, which is why every refusal in the estate stayed silent while three lifecycle states were written wrong.

**THAT MAKES `a-lifecycle-field-has-one-writer` THE SLICE THAT ANSWERS THE INCIDENT**, and the routing slices the ones that make it survivable. A hook refusing a hand edit is the only thing that can see an action nobody invoked; the controllers are what a person reaches for once the shortcut is closed.

**THE CONDITION IS THAT A REFUSAL CAN FIRE.** An action is routed when the endpoint asks a rule and stops on its answer — which `deliver` does today and `approve` does not, though both appear on the board as `{"available":true}`. **Ten endpoints exist and one of them meets this bar**, so the work is larger than the count suggests: each slice below wires a rule, not a URL.

**THIS IS THE `a-sprint-item-has-one-scorer` DEFECT, ONE LAYER UP.** That plan found `scoreItem` with no production caller while `plot-sprint-release.sh` computed the same thing in twelve lines of shell — and the two had already drifted. Here the shell computes nothing at all: it just writes, and the rule watches.

## What this is not

**Not a ban on shell scripts.** `docs/shell-and-domain.md` settled where the seam is: a script that runs once per operator command asks the domain; one that runs once per agent per pass may duplicate a rule, declared and held by a corpus test. A sprint start is the first kind.

**Not a claim that every write needs a transition.** A brief, a changeset, a note in a plan's Notes section — none is a lifecycle state, and none has a rule that could refuse it.

**Not new rules.** `setSprintState` is written and tested. What is missing is that anything calls it.

## Slices

### A master agent cannot write a lifecycle field by hand (Branch: infra/a-lifecycle-field-has-one-writer) <!-- waits: feature/a-sprint-transition-is-performed -->

A gate refuses a commit that edits a `State:` line outside the scripts that own it.

**IT WAITS FOR THE TRANSITION ABOVE**, because a gate that refuses the only available method is a gate that stops work.

**THE READING IS THE DIFF, AND THE OWNERS ARE A SHORT LIST.** `plot-approve.sh`, `plot-deliver.sh` and the new sprint command write these lines; a commit touching `- **State:**` in `docs/plans/` or `docs/sprints/` from anywhere else is the case this refuses. Measured 2026-09-08: three such edits in one session, all by hand, all by `sed`.

**IT IS A GATE BECAUSE NOTHING ELSE CAN SEE THE ACTION.** Every other refusal in this estate fires when something is invoked — a script, an endpoint, a rule. A `sed` over a markdown line invokes none of them, so no amount of routing reaches it. *Can you answer "did I complete this?" without doing the work?* For "did I use the transition", yes — and the answer was wrong three times in one afternoon, by the agent that wrote the rules.

**IT REFUSES THE SHORTCUT AND NAMES THE ROUTE.** `plot-phase-gate.sh` is the precedent: it blocks a commit and names the approval that would let it through. This blocks the edit and names the command that owns that write.

**Done when** a commit editing a `State:` line outside the owning scripts is refused with the command that would have done it, the owning scripts pass, and a plan or sprint created from a template passes.

### The sprint transitions are reachable from a controller (Branch: feature/a-sprint-transition-is-performed)

`/plot-sprint`'s start, commit and close call `setSprintState` instead of describing the write.

**THE RULE IS FINISHED AND DEAD.** `transitions/sprint.ts:205` names nine refusals, has a full test file, is exported from `index.ts`, and is called by nothing outside `packages/domain/`. This slice is wiring, not design.

**A REFUSAL IS PRINTED, NOT SWALLOWED.** Each carries its own sentence — *"'Planned' is not a sprint state — the four are Planning, Committed, Active, Closed"* — and a caller that reported *"could not start sprint"* would throw away the part a person acts on.

**THE PHASE WORD COMES FROM THE SCHEMA.** `SprintStateSchema.options` is the list, so a fifth cannot be invented by whoever writes the next skill.

**THE TEST REPRODUCES 2026-09-08.** A sprint file carrying `State: Planned`, started with `/plot-sprint <slug> start`, must be refused naming the four states — that is the exact sequence a master agent ran by hand, and a slice claiming to fix it should fail before the fix and pass after. Two more from the same afternoon: a sprint whose Musts parse to nothing cannot be committed, and `Planned → Active` is unreachable.

**Done when** start, commit and close perform their transition through `setSprintState`; the endpoint asks the rule and stops on its answer rather than spawning past it; a refusal prints its sentence and writes nothing; the three refusals measured on 2026-09-08 are each a test replaying that day's input; and the skill's prose describes the call rather than the file edit.

### Rejecting a delivery is a controller command (Branch: feature/a-rejection-is-a-controller-command) <!-- waits: feature/a-sprint-transition-is-performed -->

`/plot-reject` moves a plan Delivered → Approved through an endpoint rather than by editing the phase line.

**IT IS THE ONE LIFECYCLE MOVE THAT RUNS BACKWARDS**, and it has no rule at all today — no `setPlanPhase`, no refusal, nothing that asks whether the plan was ever delivered or whether its branches have since been swept. The forward moves at least have `plot-approve.sh` and `plot-deliver.sh` owning the write.

**IT WAITS FOR THE SPRINT SLICE**, which establishes the shape: a transition function, a printed refusal, an endpoint that spawns the command it already has.

**Done when** `/plot-reject` runs through an endpoint, refuses a plan that is not Delivered, refuses one whose refs are already deleted, names each refusal, and leaves the file untouched on a refusal.

### Releasing asks the controller for its verdict (Branch: feature/a-release-is-a-controller-command) <!-- waits: feature/a-rejection-is-a-controller-command -->

`/plot-release` reaches its gate through an endpoint, so the release decision is made where a refusal can stop it.

**THE FACTS ARE ALREADY COLLECTED AND THE JUDGEMENT IS STILL PROSE.** `plot-sprint-release.sh` reports every MoSCoW item's state and decides nothing — deliberately, and correctly. `/plot-release` then applies the rule in skill text: an open Must refuses, a `disputed` blocks like an open one. That rule is exactly the shape `setSprintState` has and this one does not.

**A RELEASE IS THE ONE ACTION NOBODY CAN UNDO.** A tag is public and a published package cannot be recalled, which is why the operator approves each one by name — and why the gate in front of it should be a refusal rather than a paragraph.

**Done when** `/plot-release` asks an endpoint for its verdict, an open Must refuses with the item named, the operator's approval is still required and still separate, and the skill's prose states the call rather than restating the rule.

### Adoption writes its config through a controller (Branch: feature/adoption-is-a-controller-command) <!-- waits: feature/a-release-is-a-controller-command -->

`/plot-init` writes `## Plot Config` through an endpoint that asks `proposeStack` what the readings propose.

**IT IS THE ONLY COMMAND THAT WRITES INTO A REPOSITORY PLOT DOES NOT OWN**, which makes a wrong write the most expensive one on this list — and today the whole proposal lives as skill prose over a probe's JSON.

**IT WAITS FOR `a-probe-reports-and-the-domain-judges`**, which creates `proposeStack`. Without it there is no rule to route to, only a second place to write the same file.

**Done when** `/plot-init` writes its config through an endpoint, the proposals come from `proposeStack` rather than from skill prose, a repository that already carries a `## Plot Config` is refused by name, and an unattended run reports `PLOT-UNASKED` rather than writing a guess.

### A slice's PR is opened by the fleet, not by hand (Branch: feature/a-pr-is-opened-by-a-controller) <!-- waits: feature/adoption-is-a-controller-command -->

Opening a slice's pull request is a controller command.

**IT IS THE GAP WITH NO SKILL AND NO RULE.** Measured 2026-09-08: three PRs were opened with `gh pr create` because no endpoint offers it — and the same thing happened last sprint, where fifteen branches carried finished work nobody could see because the agents that wrote it never raised one.

**A SLICE PR IS A LIFECYCLE EVENT.** The fleet scan reads it, `plot-pr-merged.sh` reads it, the delivery gate reads it. An action every reader depends on is not one to leave to whoever remembers.

**AND IT IS WHERE `a-merged-pr-carried-work` BELONGS.** That plan teaches delivery to notice a PR that carried nothing; this is the moment the same reading could refuse to open one — or open it saying so.

**Done when** a slice's PR is opened through an endpoint, the title and body come from the plan and its brief rather than from the last commit subject, a branch carrying no work outside a marker is named at open time, and `gh pr create` appears in no skill's steps.

## Notes

### The instruction this came from — 2026-09-08

Stated three times, each one sharper:

> *"Alle Aktionen gehen durch die Domain."*
> *"Was mit der Domain nicht möglich ist kannst du nicht machen."*
> *"Keine Abkürzungen: Eigentlich alle Controller Commands müssen durch die Domain. Der Master Agent verwendet die Controller."*

The first is a routing rule, satisfiable by calling a rule and ignoring its answer. The second closes that: a refusal ends the action. **The third names the layer** — not *the domain* in the abstract, which invites calling whatever shell script sits nearest to it, but **the controller**, which is where the refusal lives.

**And it is aimed at the right actor.** Every one of the three mistakes was made by the master agent, not by a dispatched worker; each was a hand edit that no reviewer saw because it was not a code change. The rules existed. Nothing asked them.

### A hook can enforce this, and one already does — 2026-09-08

**`hooks/hooks.json` holds exactly one entry**: a `PreToolUse` hook on `Bash` running `plot-phase-gate.sh`, which blocks an implementation commit while its plan is Draft. So the mechanism this plan needs is installed, wired and proven — on one rule.

**Two shapes, and they are not equally useful here.**

A `PostToolUse` hook could *trigger* a controller: branch pushed → open the PR. That addresses a real failure — fifteen branches last sprint and three today carried finished work with no PR — and it is what `a-pr-is-opened-by-a-controller` makes possible.

A `PreToolUse` hook *enforces*: it sees the `sed` before it runs and answers *that write belongs to `setSprintState`*. **This is the shape that matches the defect.** All three mistakes measured here were hand edits no review could see — no script diff, no test, no PR. A trigger would not have caught one of them.

**THE ORDER IS THE CONSTRAINT, NOT THE MECHANISM.** A gate refusing the only available method stops work rather than routing it, which is why `a-lifecycle-field-has-one-writer` waits: the controller has to exist before the shortcut is closed. `plot-phase-gate.sh` earned its place the same way — it names the approval that would let the commit through.
