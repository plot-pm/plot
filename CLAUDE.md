# Plot

Git-native planning workflow for software development. Plans are markdown files on branches; git is the source of truth.

**Design authority:** [MANIFESTO.md](skills/plot/MANIFESTO.md) — all design decisions must pass its 9-question checklist. When in doubt, the manifesto wins.

## Plot Config

Plot dog-foods its own config mechanism. Helpers read these via `skills/plot/scripts/plot-config.sh get <key> [default]`.

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Delivered index:** docs/plans/delivered/
- **Sprint directory:** docs/sprints/
- **Plan template:** .plot/templates/plan.md
- **Claim stale after:** 24
- **Worker bound:** 28800
- **Checks wait:** 3600
<!-- Seconds a single prompt run may take before the worker loop ends it — the
     FLOOR under the reading, not the reading itself. Since 2026-08-30 a worker
     ends when the WorkerMonitor reports `idle` (alive, no CPU across two
     passes, tree unchanged, commits on the branch), so this timer fires only
     when the monitor ITSELF has died. It was 3600 while it decided every
     worker's fate, and 3600 is what killed seven working agents on this estate
     that day — each with 3-6 commits, five losing a different last step. At
     28800 (a working day) no honest run reaches it and a monitor-less hang
     still cannot burn a night. `0` disables the floor, not the reading. See
     skills/plot/scripts/plot-worker-loop.sh. -->
- **Correction budget:** 2
<!-- How many times a FAILING BUILD is handed back to the agent that pushed it
     before a person is asked. The BuildMonitor publishes `build failed`; the
     loop reads it on its next pass, writes the failure text verbatim into
     PLOT-CORRECTION.md in the desk, and resumes the agent's own session. Past
     the budget it writes a PLOT-BLOCKED marker naming the attempt count — the
     correction loop does not remove the human gate, it stops reaching for it
     first.

     TWO IS A GUESS AND IS RECORDED AS ONE. Nothing has measured it; the first
     real number comes from watching the fleet correct real builds. Two says
     *try once more, then ask*. Raise it where CI is flaky, lower it to 0 to
     restore the pre-2026-09-12 behaviour of blocking on the first failure.

     It is NOT `START_ATTEMPT_BUDGET`, which bounds a prompt that never ran, is
     env-only at a default of three, and is deliberately not a config key: a
     project has no separate opinion about a broken invocation, and does have
     one about its own failing builds. See
     skills/plot/scripts/plot-worker-loop.sh. -->
- **Agent registry:** /Users/jwloka/Quatico/Agentic-Tools/plot/.plot/agents
- **Board artifact:** skills/plot/scripts/board/board-server.mjs
- **Agent settings:** .plot/agent-settings.json
- **Local checks:** test/reconcile/*.test.mjs = node --test {tests}; packages/domain/** = pnpm --filter @plot-pm/domain exec vitest related --run {changed}; packages/domain/src/** = pnpm --filter @plot-pm/domain exec tsc --noEmit -p .; packages/board/src/** = pnpm --filter @plot-pm/board exec vitest related --run {changed}; packages/board/src/** = pnpm run typecheck; ** = node --test test/reconcile/*gate*.test.mjs; ** = ./scripts/check-script-names.sh && ./scripts/check-temp-paths.sh && ./scripts/check-ancestry-decisions.sh && ./scripts/check-host-cli-callers.sh && ./scripts/check-claim-prefix-comparison.sh && ./scripts/check-bundle-resolution.sh && ./scripts/check-state-declarations.sh && ./scripts/check-bundle-attributes.sh && ./scripts/check-plan-headings.sh && ./scripts/check-changeset-packages.sh && ./scripts/check-desk-markers.sh && ./scripts/check-agents-md.sh
- **CI suites:** pnpm run test:e2e; pnpm run test:contracts; pnpm run test:board; pnpm --filter @plot-pm/domain exec vitest run --coverage; node --test test/reconcile/*.test.mjs
- **Board command:** pnpm board
- **CI:** github-actions
- **Worktree root:** .worktrees
- **People:** jwloka = Jan Wloka; eins78 = Max Albrecht
- **Worker command:** PLOT_UNATTENDED=1 PLOT_MODEL=sonnet skills/plot/scripts/plot-worker-loop.sh
<!-- The loop script implements, then asks `--next` for the next wave, claims
     it, and moves to its worktree — repeating until the plan has no more
     claimable branches. The prompt itself lives in `.plot/worker-prompt.sh`,
     separated because plot-config.sh strips `(...)` as prose and the prompt
     contains shell constructs like ${PLOT_BRANCH##*/}.

     `bypassPermissions` is set in the prompt file, not here, because the loop
     script sources it. A detached worker is non-interactive: nobody can answer
     a prompt, and `acceptEdits` left one unable to run `pnpm test`,
     `pnpm build:board` or `git commit` — it wrote the code, reported honestly
     that it had verified nothing, and left the work uncommitted (2026-08-17).
     The cost is real and chosen: on the same day `plot-resolve-artifact.sh`
     ran `git merge` inside another agent's active worktree and retried 111
     times. Under this mode nothing would have stopped it. The brief is
     therefore the only guard a worker has — keep its scope guards explicit. -->

- **Idea command:** PLOT_UNATTENDED=1 claude -p --model opus ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"} --permission-mode bypassPermissions

<!-- `Idea command` runs `/plot-idea` on a tracker issue for the board's
     `Create plan` action. The board appends ONE argument naming a file it wrote
     — `Read <path> and follow it.` — and exports `PLOT_IDEA_PROMPT` with that
     path plus `PLOT_ISSUE` with the number. Nothing from the issue is ever a
     shell word: an issue body is free text from anyone who can file an issue,
     and a single `"; rm -rf ~` in a value interpolated into a `sh -c` fragment
     would execute. The file is the safety property, not a convenience.

     Deliberately SHORT where `Worker command` is long. A worker is handed a
     brief and told not to widen its scope, so its guards must be spelled out;
     `/plot-idea` IS the instructions, and every step of it is judgement. A
     prompt here that restated the skill would be a second, drifting copy of it.

     `PLOT_UNATTENDED=1` is a declaration, not a switch: there is nobody at the
     board to answer `AskUserQuestion`, and under `claude -p` that tool is not
     even registered — so a skill that improvises exits 0 having written
     nothing. Set, each skipped question takes the shape its author chose and
     names itself in the log. -->

- **Story command:** PLOT_UNATTENDED=1 claude -p --model opus ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"} --permission-mode bypassPermissions
- **Brief command:** PLOT_UNATTENDED=1 claude -p --model sonnet ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"} --permission-mode bypassPermissions
- **Implement command:** PLOT_UNATTENDED=1 claude -p --model sonnet ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"} --permission-mode bypassPermissions
- **Interrogate command:** PLOT_UNATTENDED=1 claude -p --model opus ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"} --permission-mode bypassPermissions

<!-- `Implement command` runs `/plot-implement <slug>` for the board's
     `Implement` control and for `WriteBriefButton`, which is the same route
     under the word a refused row is asking. Unset until 2026-09-06, and that
     was measured rather than noticed: nine eligible slices sat unbriefed for
     hours while eight agents idled, `/api/dispatch` refused every one with
     `no-implement-command`, and the button that fixes it could not act either.
     The remedy shipped; the key naming how to run it did not. -->

<!-- `Story command` runs `/story-tracking` on a tracker ticket for the board's
     `Create story` action — the twin of `Idea command`, and the same shape down
     to the argument: ONE argument naming a file the board wrote, `PLOT_ISSUE`
     with the number, `PLOT_STORY_PROMPT` with the path. Nothing from the ticket
     is ever a shell word, for the reason stated above.

     SET HERE, and that is part of the change rather than an afterthought.
     `Idea command` was configured and this was not, which is precisely why one
     button worked and the other refused. Shipping the capability without its
     first configuration would leave *Create story* still refusing in the repo
     that dog-foods Plot — honestly now, but with its happy path unexercised —
     and an unset key looks identical to a broken feature.

     The board counts story homes from `Story directory` (unset here, so the
     default `docs/stories/` — one home), NEVER from the filesystem. A measured
     client repo holds website content and image assets under paths matching
     `stories/`, where a search counts four homes and the declaration says one.
     Several DECLARED homes refuse and name the question rather than guessing: a
     missing story is recoverable, a story in the wrong home is referenced from
     elsewhere before anyone notices. -->

<!-- `Interrogate command` runs `/plot-panel <plan path>` for the board's
     `Interrogate` button on a Draft card, and it is REQUIRED rather than
     optional: `Approve` falls back to `plot-approve.sh`, which performs the
     seven mechanical steps, while a panel is N agents reading one plan through
     N personas and there is no script to fall back to
     (`interrogate.ts:24`). The route itself decides nothing — it writes the
     prompt, the log and a state file outside the repository, and the SKILL
     writes the verdict files, `panel.md` and the plan's `Rounds:` increment.

     SET HERE, for the reason `Story command` states three notes above: an
     unset key looks identical to a broken feature. Measured 2026-09-27 — an
     operator saw no Interrogate button on four Draft cards and asked whether
     the jury action was broken. It was not: `interrogate-route.test.ts` passes
     9 of 9, including *"runs the command; Rounds: rises by one; the board wrote
     nothing to the plan"*, and the route was refusing honestly with a reason
     naming this key. The capability shipped; its first configuration did not,
     which is the same shape `Story command` records and the reason that note
     says shipping one without the other leaves the happy path unexercised. -->

<!-- Optional: **Approve command:** how to run an agent headless for ONE prompt;
     the board appends `/plot-approve <slug>` and gets the full skill — the
     ceremony questions, the tracer heuristic, the in-session walkthrough.
     Without it the board runs `plot-approve.sh` directly, which does the same
     seven mechanical steps and refuses what needs a reader. -->

## Architecture

Plot is a hub-and-spoke skill system:

| Role | Skill | Purpose |
|------|-------|---------|
| Hub | `plot/` | Dispatcher — reads git state, suggests next action |
| Command | `plot-init/` | Adopt Plot in a repo: probe what it already is, propose the config from that, create the skeleton, offer extensions only where a signal justifies them |
| Command | `plot-board-setup/` | Adopt the board in a project that has Plot: probe prerequisites, record git-host and CI config, and prove it serves. Adoption only since 2026-09-06 — its `--start` flag was removed, not aliased |
| Command | `plot-board/` | Board control — `--start`, `--stop`, `--status` over the local board. Processes, not plans: `--stop` finds the board by TWO facts that must agree — the pid `--start` recorded, and whoever holds the port, which must be that pid or descend from it because `node --watch` supervises the child that binds. Every disagreement is named and refused; a `pkill -f` over process names killed an operator's board on 2026-09-04, and that guess is what the rule refuses |
| Command | `plot-idea/` | Create plan with ceremony matched to the change (two-question triage, posture gates) |
| Command | `plot-approve/` | Record the plan's approval through its declared review channel — and stop |
| Command | `plot-implement/` | Start/resume implementation: staleness preflight, branch setup, hand-off brief, Started record |
| Command | `plot-deliver/` | Verify all impl PRs merged (cross-repo aware), deliver the plan |
| Command | `plot-release/` | Cut versioned release with changelog |
| Command | `plot-reject/` | Move a prematurely delivered plan back to Approved |
| Command | `plot-reconcile/` | Read-only hygiene sweep — plan/branch drift with remediating commands; prints the commands and runs none |
| Coordination | `plot-sprint/` | Time-boxed sprint with MoSCoW priorities |
| Coordination | `plot-dispatch/` | Fan out an approved plan: one worktree + one detached worker per eligible branch, each claimed by ref push (the writing half of the fleet) |
| Coordination | `plot-merge-queue/` | Safe merge order + collision prediction for a plan's finished branches (read-only; merges nothing) |
| Coordination | `plot-pulse/` | Fleet pulse — which branch waves are complete/eligible/blocked, which branches are claimed (read-only, stateless) |
| Coordination | `plot-fleet/` | Fleet control — `--once`, `--status`, `--start [N]`, `--stop` over `plot-registryd` and its agents. Processes, not slices: `--stop` orchestrates `plot-dispatch --stop` per branch rather than adding a second stop rule, and unloads the supervisor LAST |
| Coordination | `plot-reslice/` | Slice a plan's multi-branch wave into one wave per branch — reads the branches' diffs and PRs, proposes named waves in an argued dependency order, a person confirms before it rewrites only the `## Branches` section |
| Coordination | `plot-panel/` | Question ONE plan with N lenses at once — one prompt varied only by persona, one verdict file per juror, and a moderator that names disagreements rather than averaging them. **A mechanism, not a lifecycle step**: it moves no phase and decides nothing; `/challenge-the-plan` and `/plot-deliver` are its intended callers and neither is built here. Its gate is the part that is more than parallel subagents — a verdict file naming no position is REFUSED, because fan-out, files and reconciliation all work perfectly with the gate absent and the panel still looks finished. The commitment vocabulary is the CALLER'S (`proceed/amend/reject` for a Draft juror, `supported/refuted` for a delivery one) and the mechanism knows neither; hardcoding one is what makes the second caller impossible, and the second caller is why it is extracted. Named `panel`/`juror` and never `verdict`, which in this estate is a slice's wave eligibility |
| Automation | `ralph-plot-sprint/` | Automated sprint runner (shell loop wrapper) |
| Companion | `challenge-the-plan/` | Deep plan interrogation (design-phase: idea → challenge → approve) — usable standalone, not a plot spoke |
| Companion | `story-tracking/` | Multi-session work tracking (stories = umbrella around plans) — usable standalone, not a plot spoke |
| Companion | `tracer-bullets/` | Thin vertical slice strategy — usable standalone, not a plot spoke |

Spoke commands reference helper scripts via relative path: `../plot/scripts/plot-pr-state.sh`.

## Helper Scripts

Every script in `skills/plot/scripts/` has a row in [skills/plot/scripts/README.md](skills/plot/scripts/README.md), which states what it answers and why.

A new script gets a row there. `scripts/check-helper-table.sh` is the gate.

Design split (Manifesto Principle 3): **skills interpret and adapt; scripts collect and report.**

## Model Tiers

Every skill includes a `## Model Guidance` table mapping steps to capability tiers:

- **Small (Haiku)** — Mechanical: git commands, template filling, structured output parsing
- **Mid (Sonnet)** — Heuristic: title similarity, version bump suggestions, discovery with rules
- **Frontier (Opus)** — Judgment: completeness verification, semantic gap detection, unstructured comparison

Smaller models degrade gracefully — they ask humans where larger models decide autonomously. When changing steps in a skill, update its Model Guidance table.

## Phase Guardrails

Four workflow phases: **Draft → Approved → Delivered → Released**

Each command validates the current phase before acting:
- Cannot approve an unreviewed draft
- Cannot deliver with open implementation PRs
- Cannot release undelivered work

## Project-Agnostic Design

Plot contains zero hardcoded project names, paths, or configuration. Adopting projects describe their conventions in a `## Plot Config` section of their `CLAUDE.md`. Plot discovers and adapts — never enforces.

## Skill Authoring

- Each skill directory: `SKILL.md` (frontmatter + instructions) + `README.md` (dev docs, required)
- **Use `/writing-skills`** when planning, creating, editing, or reviewing skills
- Progressive disclosure: overview in SKILL.md, details in referenced files
- Third person ("Processes files" not "I help you process files")
- Keep skills generic — no account-specific data
- When skills say "ask the user", use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor)
- Keep the root README.md skills table in sync

## The Domain Package

`@plot-pm/domain` is new code and holds a stricter style than the board it was
extracted from. These three rules apply to `packages/domain/**` and **not**
retroactively to `packages/board/**` — measured 2026-08-29, the board carries
507 `function` declarations against 6 arrows, and rewriting them would produce a
repo-wide diff with no behaviour change that destroys `git blame` for every
touched line.

**The design spec's terminology is binding.** The specs in
`docs/stories/the-master-agent-holds-the-fleet/` define the vocabulary, and code
follows them rather than the other way round. In particular a **Slice** holds
exactly one branch and belongs to one plan; a **Wave** is the fleet's cohort,
spans plans, and is persisted nowhere ([DESIGN-slice.md](docs/stories/the-master-agent-holds-the-fleet/DESIGN-slice.md)).
The code still says `Wave` where it means `Slice` — that is a known defect with
its own plan, and **no new code may add to it.**

**An Agent is the actor; "worker" is only how a process sees it.**
`DESIGN-agent.md` settles this: *"A 'worker' is not a separate thing an Agent
has — it is the Agent, observed through the process table."* So the actor is
named **Agent** everywhere it is the subject, and future specialised agents that
are not loop-workers stay expressible.

`Worker` survives in exactly two places, and both are about the PROCESS rather
than the actor:

- the six process states (`running`, `finished`, `failed`, `ended`, `none`,
  `elsewhere`) — literal process-table observations
- the config keys `Worker command` and `Worker bound`, which name what a
  dispatched agent *runs* and how long its loop may take

**A Worker is the process an Agent runs on a Machine.** It is not a synonym for
either and not merely a view of one — it is what connects them:

```
Machine  ──hosts──►  workers          (many; the resource they compete for)
Agent    ──runs───►  one worker       (at a time; its process, while it lives)
Worker   = an Agent's process on a Machine
```

**`elsewhere` is the proof.** It means *"no worktree on this machine"*
(`DESIGN-agent.md`) — an agent that exists while its worker runs somewhere else.
That state is only expressible if the worker is the LINK rather than a view: a
view of an agent cannot be somewhere the agent is not. `machineAtDeath` closes
the same circle — a worker dies **on** a machine, and that machine's state at
the moment is worth recording.

**The eight states split along the same line, and the source decides.** Four are
Worker facts read from the process (`running`, `failed`, `ended`, `none`); two
are **Agent** facts read from the desk (`waiting` — a `PLOT-BLOCKED` marker;
`stalled` — unlanded work); `finished` is a Worker fact the desk refines; and
`elsewhere` is a Machine answer. `plot-worker-state.sh:46` decides the two
workflow states from the TREE, never from the process — an exited process is a
precondition for reading them, not the reason they hold.

**For new code this means:** a state answering *what is the process doing?* goes
on the worker; one answering *what does this agent owe, or still hold?* goes on
the agent. They live in one enum today for a historical reason, and that is not
a licence to add a workflow state to the process side.

**So the vocabulary follows the component doing the observing:**

| | **Machine** | **Registry** |
|---|---|---|
| sees | processes | identities |
| counts | **workers** | **agents** |
| answers | *is it running, and what did it cost?* | *who is this, and what may it do?* |
| when absent | the process is gone | the agent was never declared |

The specs already speak this way. `DESIGN-machine.md` measures *"7 workers died
`exit 124`"* and *"five workers ran fine at load 10"*; `DESIGN-agent.md` draws
`registry ──provides──► agents`. **So `Worker` is Machine-side vocabulary and
`Agent` is Registry-side**, and a field belongs to whichever component produced
it.

That is why the exceptions are exceptions rather than inconsistencies: the six
process states, `WorkerActivity`, and `Worker command` / `Worker bound` are all
things the machine observes or launches. **A specialised agent that never
becomes a loop-worker still has a registry entry and still has no worker
fields** — which is precisely the shape this split keeps expressible.

**Arrow functions, not declarations.** `export const f = (…) => …` in the domain
package. The board's style is not the model here.

**And anywhere else, a function you write or rewrite is an arrow.** The scope
above is about what gets CONVERTED, not about what gets written: the board is
not migrated wholesale, but a new helper in a board file or a test is an arrow
like everything else. The rule follows the diff.

**The unit is the function, not the file.** Renaming a type inside an existing
signature does not make its 60 neighbours yours to rewrite — that produces a
diff with no behaviour change and destroys `git blame` for every touched line,
which is the same measurement that scoped the conversion in the first place.
If you are writing the body, it is an arrow; if you are passing through, leave
it.

**No gate enforces this outside `packages/domain/src/`**, and the CI check
greps only there. Measured 2026-08-30: a new test helper in `test/reconcile/`
was written as a declaration, sitting between two arrows in the same file, and
what caught it was a person reading the diff. That is the difference this repo
draws between a rule and a gate — so this one is a rule, and it needs reviewers
who know it.

**Factual API documentation.** A TSDoc block says what an export does, what its
parameters mean, what it returns, and how it fails. It does not narrate the
history of the decision. Measured on the first rule moved into the package:
**28 lines of code carrying 109 lines of comment**, a 4:1 ratio, most of it
argument rather than interface.

**Where the reasoning goes instead**: the plan, and the commit message. Both are
dated, both are searchable, and neither is read by someone trying to learn what
a function returns. A measurement worth keeping — *"a plan with no merged slice
read as delivered, 2026-08-20"* — belongs in the commit that introduced the
guard, so `git log -S` finds it.

## The Layering Rule

**Settled 2026-08-30.** One direction, no shortcuts:

```
controller  →  domain  →  port  ←  adapter  →  script / git / process
```

- **A controller calls the domain.** It never spawns.
- **The domain owns the port** — an `interface`, no runtime code. It defines what
  it needs; it does not import an adapter.
- **An adapter implements the port** and is the only place that may reach the
  world. `machine-system.ts` imports `ports/machine.js`; `ports/machine.ts`
  names `adapters/` zero times. **The dependency points inward.**
- **Scripts can only be called from an adapter implementation.**
- **A connector is a kind of adapter, and the distinction is load-bearing.** A
  connector reaches a **remote service**: it has an account, credentials, a rate
  limit and a transport choice. Every other adapter reaches the local machine,
  where none of those exist. Measured 2026-09-01: of nine adapters, **one** is a
  connector — `host` shells to `plot-host.sh` and its 11 `gh`/`bb`/`jen`/`jira`
  calls, while `refs`, `processes`, `plan-store` and `performer` shell to scripts
  that make **zero**. `refs` carries 12 ops to `host`'s 6 precisely because
  nothing charges for `git rev-parse`.

  **The rate-limit contract therefore belongs to the connector kind, not to
  every adapter.** Only a connector answers *what is your limit and how well do
  you know it*, records what a call spent, and chooses REST versus GraphQL. A
  filesystem port must not be made to implement any of that.

  **There are now two connector ports, and that is the shape rather than an
  exception.** `host` reaches the git host; `tracker` reaches the issue tracker.
  `Tracker` is a `## Plot Config` key declared **independently of `Git host`**,
  so a repository whose code lives with one vendor and whose tickets live with
  another has TWO remote services with two accounts, two tokens and two windows
  — and asking one interface about both made a capability belonging to one
  service report *not my department* through the other. The tracker's two
  implementations are likewise two connectors rather than one adapter with a
  vendor branch: neither ever sees the other's credentials or budget. A
  repository that declared no tracker gets `trackerNone`, which answers
  `unaskable` on every operation **including the write** — a silent success
  there would report a status reaching a tracker somebody configured while
  nothing left the machine.

  **It stays on the adapter side of the port, with one exception that is not
  yet fixed — and the exception has moved.** `Host` names six questions and no
  transport, no account, no bucket, and **`ports/host.ts:16` now declares
  `HostBackend = string`**: the port is open. The closed list survives one layer
  down, at `host-shell.ts:30` — `const DRIVES = ['github', 'bitbucket']`, which
  `:275` throws on. So adding GitLab is **not** an adapter-only change today,
  but what blocks it is an adapter's own list rather than a type in the domain.
  Treat the adapter-only property as the target, not the current state. See
  [`the-build-pipeline-is-its-own-connector`](docs/plans/2026-09-07-the-build-pipeline-is-its-own-connector.md),
  whose second slice removes it.
- **No domain-specific code or behaviour lives outside the domain.**

**Both boundaries are now gated, and the outer one is a ratchet with room left.**
The purity gate holds the inner boundary: outside
`packages/domain/src/adapters/`, the domain may import `zod` and nothing else —
measured 0 violations (`ci.yml:186`). The outer boundary is held by *One place
reaches a process* (`ci.yml:259`), which counts direct `spawn`/`execFile` sites
outside `adapters/` and fails when the number **grows**: measured 2026-09-07,
**19 sites against `allowed=28`, target 0**.

**No shell script is reached outside an adapter.** Of those 19, **zero** call a
`plot-*.sh`. What remains is `git` (in `idea.ts` and `continue.ts`), a
caller-supplied command (`registry.ts`, `fleet.ts`), and the `sh -c` starts for a
project's configured command in the eight action endpoints. Different tools
through different contracts, and the gate's own comment names them as the next
slice's scope.

> This paragraph read *"the outer boundary is not enforced: `packages/board/src`
> holds **65** `spawn`/`execFile` lines across 23 files, and CI has zero path
> references to it"* until 2026-09-07, when both halves were measured false.
> `the-sprint-proves-its-own-goal` added the ratchet and `production-calls` did
> the migration it counts — and nothing came back to say so.

**Every rendered state is a domain property.** Settled 2026-08-30, and it is the
testability half of the rule above:

> **All existing workflows, and all view states that are rendered in HTML, can be
> tested through state properties or behaviour on domain objects.** That makes
> every important thing we can *show* or *manipulate* unit-testable.

**What this rules out** is a decision made in a component. If a row's section, a
button's disabled state, or a badge's wording is computed in `.tsx`, the only way
to test it is to render it — and rendering is how 42 of this repo's 43 browser
tests came to start a full board server.

**What it does not rule out** is browser tests. It changes their subject: they
stop being where behaviour is *decided* and become where it is *seen*. A
`verdict` computed in the domain and asserted in a unit test still needs one
test proving the badge shows it.

**The measurable form:** a view state that cannot be asserted without a browser
is a domain property that has not been extracted yet.

**A note on shape.** The domain here takes **readings as values**, not ports —
`reap(readings, input)` rather than `reap(ports)`. No rule or workflow imports a
port or awaits anything. That keeps the core synchronous and testable without
mocks; the cost is that the caller decides what to read. It is a deliberate
variant of ports-and-adapters, not a deviation from the rule above.

## A Shell Script Asks The Domain

**The other direction, and it has its own contract:** [docs/shell-and-domain.md](docs/shell-and-domain.md). The layering rule above says a script is reached only from an adapter; this says how a **bash** script reaches a **rule**.

**Settled 2026-09-07, and the cost rule is a measurement.** `node -e ''` starts in 34 ms and a shipped bundle under `skills/plot/scripts/board/` answers in 39 ms. A script that runs **once per operator command** calls the domain — `plot-approve.sh` already does. A script that runs **once per agent per pass** duplicates the rule, and a corpus comparison holds the pair; `plot-worker-loop.sh` is that case.

**Duplication is allowed and undeclared duplication is not.** `plot-pr-merged.sh` is sourced by four scripts while `rules/reapable.ts` and `rules/queue.ts` answer the same question in TypeScript, deliberately. What makes it safe is not that one side is authoritative — it is that a test says they agree.

**A duplicated rule joins the corpus tier** at `packages/domain/corpus/`, and a disagreement names both answers and the subject: `the-scripts-say-slice :: state :: rule="withdrawn" shell="open"`. `corpus/sprint-score.corpus.test.ts` is the first — `scoreItem` against `plot-sprint-release.sh`'s `item_state`. **On a disagreement the branch stops**; adjusting either side to make the comparison pass is the one move forbidden.

**No gate enforces this**, and it is a rule for the reason the domain's arrow-function rule is one: which of two implementations is right is judgement, and a grep cannot tell a declared duplicate from a forgotten one. What is gated is the pair once declared — the corpus test fails when they drift.

**The target, named by `the-shell-shrinks-into-the-domain`: an agent runs a command, and a command is a JS entry point.** It goes entry → domain → port → adapter, the layering rule above. A `.sh` file that remains is a **launcher**: it resolves its bundle and `exec`s it, and decides nothing. `skills/plot/scripts/README.md`'s *kind* column names which scripts already are one.

**The price: a new declared duplicate pays in lines.** Both seams this section permits — a per-agent-per-pass duplicate and a quoted heredoc importing a rule directly — remain allowed, and both now cost: `scripts/check-shell-lines.sh` ratchets the shipped shell's line count against its merge base, so a change that adds a new duplicate must remove an equal number of lines elsewhere in the same change. The gate stores no number and grants no exemption for a declared duplicate.

## A Decision Reads The Index

**The rule, and it is a direction rather than a description:** a tool call writes the index; a decision reads it, or is triggered by it. A decision made from a freshly-bought answer depends on what a host said at one instant, which no test can reproduce and no second reader can check. A decision that reads an index is a function of recorded state.

**The rule has three parts and they hold to different degrees. Measured 2026-09-27:**

| Part | Status on `main` |
|---|---|
| 1. A tool call writes the index and returns nothing a decision consumes | **Not yet.** Both shell consumers call `plot-host.sh` on a miss and use that answer directly. |
| 2. A decision reads the index and spawns nothing | **Partly.** Two scripts read the store first and fall back to the host; neither is spawn-free. |
| 3. A decision may be triggered by an index update | **Not built.** No subscription exists. |

**The section exists because two consumers do, and not before.** `setSprintState` is the precedent this estate keeps measuring: nine refusals, zero callers, and a rule in prose that did not stop a master agent writing the field by hand. So the rule is written down after something follows it, and it names what it does not yet describe.

**The two consumers, both shipped, both shell:** `plot-impl-status.sh` (#1020) — a plan whose every slice merged costs zero host calls, proved by `test/reconcile/impl-status-index.test.mjs`'s *"a fully merged plan is answered from the store with no host call"*. `plot-reconcile-scan.sh` (#1022) — the merged-PR list call is skipped only when every asked branch has a MERGED row, and otherwise the store's rows and the host's list form a union with the host's lines first, proved by `test/reconcile/scan-index.test.mjs`'s *"a store answering every asked branch removes the merged-list call"*. Both read through ONE bundle, `board/plot-pr-index-lookup.mjs`, which calls `decodePrIndex` — never `jq` over the file, which would be a second implementation free to drift when `PR_INDEX_VERSION` moves.

**They are the first SHELL consumers and not the first consumers.** The board has read and written the store since `83c4abdc1`; `fleet.ts` folds it. A claim of zero consumers was false before wave 1 and is worth stating, because the plan made it.

**Only a terminal answer is read from the index.** A `MERGED` row cannot revert on the host. `OPEN`, `CLOSED` and draft rows are stale in either direction and the rows record no SHA to revalidate against, so both consumers take MERGED rows and ask the host for everything else — `PLOT_TERMINAL_CACHE`'s licence (`plot-fleet-scan.sh:1234`) adopted whole. Tests: *"a store row that is OPEN gives the host the last word"*, *"a draft row is re-asked rather than answered from"*.

**The index never says no, and this is the invariant a future consumer breaks first: the index can supply `pr: 'MERGED'` but not `pr: 'none'`.** A missing store, a missing row, a wrong-version or unparseable store, and a missing bundle all mean *ask the host*. A missing row in a `complete: false` store is not proof that no PR exists, and even a `complete: true` store knows nothing opened after its `at`. Measured 2026-08-27, an empty result read as *no PRs* refused four fully-merged plans.

**One writer.** `fleet.ts` is the only caller of `foldPrIndex`, and the shell consumers read and never write. A second writer beside the board races: `rename` makes each write atomic and not the read-fold-write sequence around it. Part 1 says a tool call writes the index — it does not license every script to write one.

**Answers, never verdicts.** The index holds bought answers — a host's `mergedAt`, a PR's checks, an issue's state — which cannot be re-derived at any price. A verdict is re-derivable from git for free and stale the moment a ref moves, and `fleet.ts:2173` refuses a persisted one: *"A persisted verdict would be a cache git cannot reach."* Every verdict is still derived fresh from indexed answers.

**Not behind HTTP.** A shell consumer reads the file through a bundle and needs no running board — the reason `plot-ask.mjs` exists, and the reason seven skills do not gain a dependency whose failure arrives on a worker's machine rather than the operator's.

**No gate holds this rule, and the CI spawn ratchet does not count either consumer.** *One place reaches a process* (`ci.yml:333`, `allowed=28`) greps `spawn`/`execFile` in `*.ts` under `packages/`, so a shell script's host call is invisible to it. Neither consumer moved that number, and lowering it to make the rule look earned is the gate driving the design. **The saving is a mechanism with tests and not a measured figure here**: the live store on this machine read `v: 1` against `PR_INDEX_VERSION` 2, so every read fell through to the host.

## The Master Agent Uses The Controllers

**Settled 2026-09-08. No shortcuts.** A master agent performs a lifecycle action by calling its controller. Not the script the controller calls, not `sed` over the field the script writes, not `git` where the controller would have used it. **And what the controller refuses does not happen** — a refusal is not advice to weigh, it is the end of that action.

**The two halves are one rule.** Routing through a controller and then proceeding past its refusal is the same failure as never calling it: in both cases the decision was made somewhere no rule could reach.

**Nine actions exist as controller endpoints today** — `dispatch`, `approve`, `deliver`, `idea`, `implement`, `drop`, `reslice`, `commission`, `continue` — reachable without HTTP through `skills/plot/scripts/board/plot-ask.mjs`, which is the seam `a-shell-script-asks-the-domain` built for exactly this.

**Measured 2026-09-08, in one session, by the agent that writes these rules:**

| the action | how it was done | the controller that existed |
|---|---|---|
| activate a sprint | `sed` + `ln -s` | `setSprintState` — nine refusals, zero callers |
| approve four plans | `python re.sub` on `State:` | the `approve` endpoint |
| dispatch slices | `plot-dispatch.sh` directly | the `dispatch` endpoint |
| deliver a plan | `plot-deliver.sh` directly | the `deliver` endpoint |

**Four of five actions had a controller and none was used.** The sprint one cost an hour: `State: Planned` is a word `SprintStateSchema` does not contain, the file was written by hand instead of from `templates/sprint.md` so the board parsed none of its nine items, and `commitment-empty` — the refusal for exactly that — never ran.

**Where no controller exists, the gap is the finding.** **Where a rule exists and nothing calls it, that is a defect to report** — never a licence to write the field by hand.

**Opening a slice's PR was that gap, and it is closed.** `skills/plot/scripts/plot-open-pr.sh` asks `board/plot-slice-pr.mjs`, which asks `openSlicePr`. This paragraph read *"Opening a PR has none, and that is worth filing rather than working around silently"* until 2026-09-09 — amended rather than quietly broken, the way the `plot-host.sh` line above it was. **`gh pr create` is not the route**, and the reason is a measurement rather than a preference: three slice PRs were opened that way on 2026-09-08 and each took its title from the last commit subject, which on this estate is routinely `plot: build the board artifact`. A sprint PR is not a slice PR and still goes through `plot-host.sh pr-create` — the adapter, not the controller, because no plan names a sprint branch under a wave heading.

**This binds the master agent specifically**, because a dispatched worker's changes are reviewed as code and a master agent's hand edits are not. Every mistake above was invisible to review: no diff of a script, no test, no PR.

**And since 2026-09-09 a gate sees the one shape review cannot.** `plot-state-gate.sh` refuses a commit that changes a `State:` line in a plan or sprint file unless `plot-approve.sh`, `plot-deliver.sh` or `plot-sprint-state.sh` made the write — proved by a receipt those scripts leave and no editor can forge. It covers the lifecycle FIELD and nothing else: routing an action past a controller that has no `State:` write remains a rule, and the rest of this section is why. What the gate adds is that the four hand edits measured above now stop at the commit, each naming the command that owns the write.

**Above about 200k context, the master agent briefs a `general-purpose` subagent instead of forking.** A fork starts with the parent's whole context, so its cost follows the parent's size at spawn time rather than the size of its task; a briefed `general-purpose` agent starts fresh from what the brief states. Measured 2026-10-02 in the master session: 34 `fork` subagents started at a median 336k tokens, 84M weighted, 16% of all spend, against 65 `general-purpose` subagents at a median 100k. Mechanical subtasks — search, git, test runs, verification — take `model: sonnet`, applying `## Model Tiers` above to Agent calls rather than adding a new one; a judgement task (review, design, root cause) keeps the model the task needs. **This is a rule, not a gate**: the spawn decision happens inside a model turn, and no hook reads the parent's context size to compare against. A fork is not banned — below about 200k it is cheaper than writing a brief, and it can see what the parent saw. This binds the master agent specifically, as the rest of this section does; a dispatched worker's own subagents are not covered here.

## Gates Over Rules

**For important agent behaviors, always implement gates, not rules.** ([Reference](https://blog.fsck.com/2026/04/07/rules-and-gates/))

- A **rule** is a guideline the agent can rationalize around. Rules live in `CLAUDE.md` or skill instructions and depend on the agent choosing to follow them.
- A **gate** is a hard stop with objective verification — enforced via hooks (PreToolUse / PostToolUse) where the agent cannot proceed without meeting a concrete, checkable condition.
- **The test:** Can you answer "Did I complete this?" without actually doing the work? If yes, it's a rule. If no, it's a gate.

When writing skills that include critical workflows (phase guardrails, branch creation, PR state checks, destructive operations), prefer gates via hooks over prose-only instructions. Even when the user casually says "add a rule for X," evaluate whether it should be a gate and implement accordingly.

**Skill authors:** If your skill includes a "MUST" or "NEVER" instruction, ask: is this enforced by a hook, or just written in prose? If prose-only, it's a rule and will eventually be violated. Convert critical MUSTs to gates.

**`plot-host.sh` is the ONE place that talks to the host CLI — and that is now a gate.** It was prose here throughout, and on 2026-09-05 four scripts violated it: `plot-reconcile-scan.sh`, `plot-agent-monitor.sh`, `plot-pr-state.sh` and `plot-pr-merged.sh` each held their own `gh` call. A second caller does not merely duplicate — every one of those asked about GitHub and nothing else, so a Bitbucket checkout got a helper that was absent rather than wrong. `scripts/check-host-cli-callers.sh` is the gate; its exception list names four scripts, each with the reason it asks a different question.

**Examples in plot:**
- The four phase guardrails (cannot approve unreviewed draft, cannot deliver with open impl PRs, cannot release undelivered work, etc.) are rules embedded in spoke commands. Stronger forms would be gates: a PreToolUse hook on `gh pr merge` that reads the plan's phase and blocks merges that violate the lifecycle. **What a gate now covers is the write those guardrails protect**: `plot-state-gate.sh` refuses a `State:` line changed by anything but the script that owns it, so a guardrail cannot be skipped by editing the field it guards. The guardrails themselves are still rules — the gate says *who may write*, not *whether this transition is allowed*, which is the domain's answer and only reachable by calling it.
- The "always run `pnpm test`" instruction in Testing above is a rule — a candidate for a gate via a pre-commit / pre-push hook.

## One Answer To "Did This Land"

**The host answers, not git.** `skills/plot/scripts/plot-pr-merged.sh` reads `mergedAt` — never a PR's `state` (a merged PR reports `CLOSED`), and never ancestry. Measured 2026-09-04 on this estate: ten merged branches still carried a remote ref, and `git merge-base --is-ancestor` disagreed with the host on **ten of ten**. Squash-merge rewrites the commits, so a merged branch stays ahead of main forever.

**THE SECTION'S REAL SCOPE, stated 2026-10-01 rather than left implied: this is about DESTRUCTIVE decisions.** Those read the host's `mergedAt`, and nothing else. The **wave gate** also takes a host-written merge subject on the default branch as positive evidence for a branch with NO REF — `Merge pull request #N from <owner>/<branch>` on one host, `Merged in <branch> (pull request #N)` on the other, read through `rules/merge-subject.ts` and keyed by plan, and only where the merge is not contained in the commit that added that plan's file. That has been true for one of the two forms since 2026-08-16 (`6c66b389`) and this section did not say so.

**What makes the two readings coexist is the blast radius, not the confidence.** Opening the next slice is reversible: a slice wrongly settled is re-opened by the next pulse. Flipping a phase, moving an index symlink, removing a desk or deleting a ref is not. So a subject settles a slice and never starts a delivery — `allSlicesConfirmed` reads a subject-only branch as `unknown`, and `plot-reap.sh` and `plot-release-refs.sh` read `pr_merged` as they always have. [docs/domain/merge-subject.md](docs/domain/merge-subject.md) holds the boundary table.

**`scripts/check-ancestry-decisions.sh` is the gate, and it bans the decision rather than the call.** Two ancestry callers here are correct: `plot-merge-queue.sh` skips a branch already in main before predicting a conflict, and `refs-git.ts` answers `unknown` when it cannot tell. Neither asks *did this land* — they ask *can I skip this cheaply*, where a wrong answer costs extra work rather than hiding finished work.

No grep separates them, because the difference is what the answer flows into. So every ancestry call declares its kind within five lines above it, and an undeclared one fails CI:

```
# plot-ancestry: prefilter — the answer only ever SKIPS work. Say what a wrong
#                            answer costs, and why it cannot hide anything.
# plot-ancestry: evidence  — the answer is handed on and something else decides,
#                            including answering `unknown`. Name what decides.
```

There is deliberately no third kind. A site that would need one is a site that should be reading `plot-pr-merged.sh` — or, in TypeScript, the host port's PR state.

**Two readings answer *what did this merge carry*, and they ask different questions.** `plot-reconcile-scan.sh` §22 diffs `git merge-base "$m^1" "$m^2"` and answers *did the BRANCH ship code while it was open*; `refs-git.ts`'s `commitFiles` reads `git show -m --first-parent` and answers *what did MAIN gain when it landed*. Neither is a fallback for the other, and **agreement is not the contract** — searched over 400 commits they agree on 13 of 14 true merges, and the divergence is `851727039`, a delivery booking commit whose merge-base diff reports 2 plan files while its first-parent diff is empty because main already held those edits. Both answers are right for their own question, so a corpus test asserting they match would fail on the one commit both sides handle correctly.

**`-m` and `--first-parent` are one reading and neither travels alone.** Without `-m`, `git show --name-only` prints nothing at all for a commit with two parents: measured 2026-09-13 over the last 120 commits on `origin/main`, **14 true merges and 14 read as carrying no implementation**, which is how delivery came to report that PR #907 carried none of its 410 insertions. Without `--first-parent`, `-m` emits one diff per parent and returns paths the branch never touched — 6 instead of 5 on `109cce0ac`, the extra one a plan file main gained from the other side.

## Testing

Plot is a pnpm workspace: the skills live at the repo root, and the board is a
package under `packages/`.

**Node 24.** Pinned in `.nvmrc`, declared in both `package.json` `engines`
blocks, and used by every CI job — run `nvm use` before anything else. This is
not a preference: `pnpm` crashes outright on Node 26, and a background job
under it exits silently having produced nothing, which reads exactly like a
hung test run rather than a wrong interpreter.

```bash
nvm use              # Node 24, per .nvmrc — pnpm crashes on 26
pnpm install         # install dependencies first if node_modules is missing
pnpm test            # validates all skills parse correctly
pnpm run test:contracts   # contract tests for the helper estate + CI gates (75 files)
pnpm run test:board       # rebuilds the board artifact + runs its tests
pnpm run typecheck        # typechecks @plot-pm/board

pnpm run test:e2e         # lifecycle choreography in sandbox repos — CI's job,
                          # NOT part of a local run. See below.
```

**`test:contracts` and `test:board` run in a private `TMPDIR` and `HOME`, and fail on a leaked entry.** `scripts/owned-run.sh` wraps both: it creates one `plot-run.*` root, points `TMPDIR`, `HOME`, `PLOT_BUDGET_HOME` and `PLOT_PR_INDEX_HOME` inside it for the whole process tree, and removes it whatever the exit code. An entry still in that root when the run ends came from the run — nothing else writes there — so the run fails and each entry is named with its prefix. Remove yours by the exact name `mkdtempSync` returned, never by a glob over the shared temp directory. Measured 2026-09-30: one clean run of `test/reconcile/host.test.mjs`, 266 of 266 green, left 365 entries in an empty `TMPDIR` and wrote 430 lines into the operator's `~/.plot/state/budget.tsv`.

**`test:e2e` IS CI'S GATE, NOT A LOCAL ONE.** Run it when you are changing the
lifecycle itself and want the feedback; do not run it as a matter of course, and
do not put it in a brief's list of repo gates.

It dispatches **real workers into sandbox repositories** — that is its whole
value and its whole cost. Measured 2026-08-31: two agents running it produced
**53 concurrent `node --test` processes**, load average 8.69, and an operator's
board that could not answer a request in 25 seconds. Three suites here take 5–10
minutes; several agents run them at once, on the one machine the board also
lives on.

**Nothing local depends on it passing.** CI runs it on every PR, bounded by
`timeout-minutes`, and CI is the authority. An agent that runs it locally is
paying the cost twice and starving everything else the second time.

The trade is explicit: skipping it locally means an e2e failure is discovered
after a push, costing one CI round trip. That cost is bounded and serialised. An
unbounded local run is neither, and it takes the machine down with it.

**Always install dependencies and run the checks your change touches.** Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints: the tests that name a changed file, the related tests and typecheck of a changed package, and the gate tests and `scripts/check-*.sh`. The suites in the `CI suites` key run in CI on every pull request; a fleet agent does not run them, and the controller gate refuses it at a fleet desk. If a check fails because `node_modules` is missing, install and retry — never skip a failing test or dismiss the failure.

**The board is first-class.** Keeping it working — and considering board impact when planning changes to the plan format, template, helper scripts, or `docs/plans` layout — is part of the [Definition of Done](docs/definition-of-done.md), gated in CI.

**On a conflict in `board-server.mjs`, do not read the diff, and do not commit the rebuild.** It is generated output marked `-merge` in `.gitattributes`, so git keeps one version whole rather than splicing markers into it. A PR's diff must carry no generated bundle (`scripts/check-no-bundle-diff.sh`), so the repair is to restore every conflicting generated path from the merge base against `origin/main` — the command the gate's own refusal prints — never to take a side and commit a rebuild: `main` builds its own bundles after every merge, and a bundle this branch commits is refused at commit time and again in CI. Run `pnpm build:board` only to test the result locally, then restore the generated paths before you push. Never phrase it as "take ours": *ours* inverts between `git merge` and `git rebase`. Full procedure: [Definition of Done › Resolving a board artifact conflict](docs/definition-of-done.md#resolving-a-board-artifact-conflict).

**Fleet user test:** [docs/fleet-user-test.md](docs/fleet-user-test.md) — a
guided run of `/plot-pulse`, `/plot-dispatch`, and `/plot-merge-queue` in a
real project, covering what the automated flows deliberately cannot (agent
adherence to prose, message clarity, real detached workers).

**Behavioral testing is manual.** The skills have no unit tests — validation is via end-to-end lifecycle testing (full workflow from `/plot-idea` through `/plot-release`). Any change to a spoke command or helper script should be tested with a full lifecycle walkthrough. See `skills/plot/README.md` for documented test runs. (The board, being real code, does have automated tests.)

## Contributing

- **Issues:** https://github.com/plot-pm/plot/issues
- **Decision criteria:** Does the change pass the [manifesto's 9-question checklist](skills/plot/MANIFESTO.md#making-decisions)?
- **Known gaps & improvements:** tracked in `skills/plot/README.md`
- **Codex:** the repo-root `AGENTS.md` is generated from the file Claude Code loads, with that file's name rewritten. Change the text in the Claude Code file, then run `./scripts/check-agents-md.sh --write`; CI refuses a mirror that differs.
- **Evolution history:** `skills/plot/changelog.md`

## Versioning

Every skill MUST have a `metadata.version` field in its SKILL.md frontmatter.

**Do not edit versions by hand.** Declare the bump in your changeset and let the
release process apply it — **with the description FIRST and the `bumps:` block
LAST:**

```markdown
---
'plot': patch
---

The description, which is what the changelog publishes.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
```

**The order is not cosmetic.** Changesets publishes the first line after the
frontmatter, whatever it is, so a `bumps:` block written first becomes the
release note and the description behind it never ships. Measured 2026-08-30:
19 of 169 published entries — 11% — printed a bare comment-open marker as
their whole description. `./scripts/check-changeset-packages.sh` now refuses
that, and a description shorter than 20 characters.

**A changeset may name the plan it implements**, on a `plan:` line in the same
block:

```markdown
The description, which is what the changelog publishes.

<!--
plan: docs/plans/2026-09-06-a-changeset-names-its-plan.md
bumps:
  skills:
    plot: patch
-->
```

**It is optional.** A changeset written by hand, or by a contributor with no
plan, is valid without one — 0 of 19 carried one when the field was added, so a
gate demanding it would refuse every changeset in flight. What it buys is
mechanisability: `/plot-release` step 3 cross-checks changesets against plans by
semantic match over descriptions, at Frontier tier, re-derived per changeset per
release. A link makes that a lookup; without one the match runs as before.

**The `plan:` line obeys the same order rule, and for the same reason.** Written
first it IS the published description — and `plan: docs/plans/x.md` is 21
characters, one over the floor, so length alone does not catch it. The gate
refuses it explicitly.

Choose the level the way semver asks:

- **Patch** (`x.y.Z`): bug fixes, wording improvements, minor clarifications
- **Minor** (`x.Y.0`): new sections, new patterns, expanded coverage
- **Major** (`X.0.0`): structural reorganization, removed sections, breaking workflow changes

CI validates that every skill named in a `bumps:` block is a real directory
under `skills/` — a typo fails the build rather than silently bumping nothing.

It also validates the changeset's own **package** name, which must be `plot` or
`@plot-pm/board`. This is a separate check because it fails differently: an
unknown package makes `changeset version` abort the **entire** release rather
than skip the file. Measured 2026-08-26 — six changesets named `@plot-pm/plot`,
`@plot-pm/skills` and `plot-deliver`, so the release PR could not regenerate and
sat at 8 of 98 changesets for four days, 355 commits behind main, with nothing
reporting why. Run `./scripts/check-changeset-packages.sh` locally to check.
The plugin version in the three metadata files (`package.json`,
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) follows from
the same release, at least as high as the largest skill bump in it.

> This section described manual bumps until 2026-08-17, when the practice was
> measured against it: the last six changes to the plugin version all came from
> `release:` commits and none from a feature commit. A rule that every
> contributor is asked to follow and nobody has followed for six releases is a
> rule that misleads — and it did, five times in one evening, through agents
> instructed from this file.

## Commit Conventions

- `plot: <description>` — hub skill or cross-cutting changes
- `plot-<command>: <description>` — spoke-specific changes (e.g., `plot-approve: fix branch creation`)
- Plain description — repo-level files (README, CLAUDE.md, plugin metadata)

## Status

Version 1.0.0-beta.3. Experimental, evolving through real-world usage. Originated 2026-02-07 across 5 Claude Code sessions in a private project; migrated to this standalone repo 2026-03-13.
