<p align="center">
  <img src="assets/logo.svg" alt="Plot logo" width="160">
</p>

# Plot

Git-native planning workflow for software development.

Plans are markdown files — written, reviewed, and versioned like source code. They live on branches, merge through pull requests, and stay in place forever. No external tracker, no database, no sync API. If it's not in git, it doesn't exist.

Plot works for any team composition, but is especially designed for **human decision-makers** working with **AI facilitators** and **AI coding agents**. Humans always own the decisions. Every step can also be done by a human with basic git knowledge.

## Lifecycle

```
/plot-idea (Draft)     Create plan branch + file + draft PR
     |
   Review              Human reviews, refines, marks ready
     |
/plot-approve          Record the plan's approval (merge, in-session go, or ballot)
/plot-implement        Start/resume implementation: preflight, branches, brief
     |
   Implement           Parallel work on feature/bug/docs/infra branches
     |
/plot-deliver          Verify all impl PRs merged, archive plan
     |
/plot-release          Cut versioned release with changelog
```

Sprints (`/plot-sprint`) are orthogonal — they group plans by schedule, not by workflow phase.

New to Plot? Read [Intro to Using Plot](skills/plot/intro-to-using-plot.md) for a walkthrough of the lifecycle.

## Several agents, one plan

An approved plan usually decomposes into several branches. Handing them to several agents at once raises two questions that hand-coordination answers badly: **which branches may run concurrently**, and **how does one agent take a branch without another taking it too**.

Plot answers both without adding a database.

**Waves.** Branches grouped under a `### ` subheading may run at the same time; a wave opens once every branch in every earlier wave is merged. So a tracer bullet proves the seam, then the rest fan out — the dependency real work actually has, without a dependency graph nobody keeps accurate. A plan with no subheadings is one wave, exactly as before.

**Claim-by-ref.** An agent takes a branch by pushing a claim commit to it. Two independent claims diverge, so the loser's push is rejected as non-fast-forward and exactly one agent wins. **Git is the lock** — no lock manager, no lease, no coordination file, nothing to fall out of sync. (The commit matters: a branch merely pointing at `main` does not diverge from it, so both pushes would succeed and both agents would think they held it. Plot never force-pushes, which is the other half of why the lock holds.)

Everything else is derived from that.

### The fleet commands, and the failure each one removes

Once five agents work at the same time, the scarce resource is no longer execution — it is **knowing what is happening**. Each command below exists because of a specific way that goes wrong.

**`/plot-fleet` — a dead agent and a slow one look identical from outside.** It re-reads git every run and reports which waves are complete, eligible, or blocked, and which branches are claimed. It stores nothing, so a killed dispatcher costs nothing: the next read re-derives the truth. It also surfaces a blocker that only exists once work is parallel — *approved, and nobody has taken it* — which no ticket board has a column for. Read-only.

**`/plot-dispatch` — fanning out is a decision, not a mechanical step.** It gives each eligible branch its own worktree and a detached worker, each claimed by ref push. It is deliberately a command you run rather than something that happens on a timer, because four agents mean four pull requests somebody has to read. Watching a fleet is mechanical and may run on a timer; *starting* one is a judgement about how much review you are about to owe.

**`/plot-merge-queue` — every branch merges into `main` cleanly on its own, and two of them still break each other.** It names the safe order and flags which branches collide with one ahead of them in the queue. That failure is invisible to per-branch CI by construction: each branch is tested against `main`, never against its siblings.

**`/plot-reslice` — a wave holding several branches cannot be claimed atomically.** The claim is a push to *one* branch, so a wave with three branches in it has no single thing to win. Reslice reads the branches' diffs and PRs, proposes one wave each in an argued dependency order, and rewrites only the `## Branches` section after a person confirms.

**`/plot-reconcile` — derived state is honest, but the estate still drifts.** A read-only sweep for plans whose phase and index disagree, merged-but-undelivered work, and stale branches. It prints the remediating commands; you decide what to run.

### The board sorts by whose turn it is

Every command above answers a question in a terminal, once, and the answer is gone when the scrollback rolls. The board (`pnpm board`) is where the answer stays — and it is organised around a different question than a ticket board asks.

**Not "what is the work?" but "whose turn is it?"**

| Section | What is in it | What it asks of you |
|---------|---------------|---------------------|
| **WAITING ON YOU** | Your actual queue | Act. This is the only section that needs you. |
| **WORKING** | Agents implementing right now | Nothing. Just look. |
| **WAITING ON A MACHINE** | CI, merges, pushes in flight | Nothing — unless it is stuck. |
| **NOT STARTED** | Approved, and nobody has taken it | Dispatch it, or decide it can wait. |
| **QUIET** / **DONE** | Idle, and finished | Nothing. |

Only the top section carries your name; everything below it is information. That single inversion is the point: **the length of "waiting on you" is your real WIP limit**, not the number of open tickets — because with a fleet running, open tickets stop being a measure of anything a human controls.

It also distinguishes five kinds of waiting that a branch-first board renders identically — a ticket to triage, a plan to approve, a finished wave to land, a broken build to fix, a release to cut. Lead every row with a branch name and all five wear the same face, so you re-derive what is being asked of you each time you look.

Everything it shows is derived from git on a timer, so the board never becomes a second source of truth — kill it and nothing is lost. It can also *act*: approve a plan, dispatch a wave, deliver, reslice. Every one of those runs the same skill you would have run in the terminal, so the board invents no lifecycle transition of its own, and the write endpoints are bound to loopback. Set it up with [`/plot-board-setup`](skills/plot-board-setup/).

### Why merging stays yours

Three speeds, and the sorting is the whole argument:

| Speed | What belongs here | Why |
|-------|-------------------|-----|
| **Automate** | Creating branches, moving symlinks, cutting an RC tag, watching the fleet | Mechanical transitions with no judgement. Waiting is pure waste. |
| **Let it run** | Implementing a branch, writing a plan, working a checklist | Where the actual work happens. Not bottlenecks — the point. |
| **Never accelerate** | Approving a plan, fanning out a fleet, deciding to release, **merging** | Each one multiplies what follows it. |

Merging sits in the third row even though `/plot-merge-queue` has already computed the collision-free order. **Automating the order removes guesswork; automating the landing would remove the last checkpoint** in a flow that has just multiplied its throughput. Because landing stays with you, throughput never outruns review.

**Every step of this is something you could do by hand.** Claiming a branch is `git push`. Giving an agent its own workspace is `git worktree add`. Checking what is in flight is reading refs. Plot makes that faster and keeps it honest; it does not make it possible, and there is nothing to learn that is not already git. That is also the exit: stop using Plot and your plans are still markdown, your claims are still branches, and nothing needs migrating.

**No database is the feature, not the omission.** Orchestrators usually need one because their tickets have no home. Plot's plans *are* the work table and its branches *are* the claims — so there is no second store to fall out of sync with git, and no state that survives being wrong.

Start with [Working several branches at once](skills/plot/intro-to-using-plot.md#working-several-branches-at-once).

### How this compares

Two designs shaped this, and it is worth being precise about what was taken and what was deliberately left:

**[Scape](https://www.scape.work/)** runs many agents in isolated worktrees with a live fleet dashboard, and sells scale — *"ten, fifty, a hundred sessions."* The worktree isolation is the same idea, and a good one. What Plot does differently is the axis: not *how many agents can you run*, but *how many can safely work one reviewed plan at once*. Waves exist because the answer is usually "not all of them yet." Plot is also plain git and markdown on any platform, with no app to keep running.

**The [Lloyd loop orchestrator](https://explainx.ai/blog/claude-code-loop-orchestrator-heartbeat-ticket-memory-august-2026)** is a persistent agent on a heartbeat with a SQLite ticket table. Three of its lessons are directly in Plot: state must outlive any one context (git, not SQLite), read-only investigation gates every write (only `/plot-dispatch` touches branches or processes at all), and the agent *proposes* while the human decides. Its fourth — log clean pulses, or you cannot tell an idle fleet from a dead one — is why `/plot-fleet` records a line even when nothing changed. Its author's own framing applies here too: the tooling is replaceable, the discipline is not.

**Deliberately not built:** autonomous merging (the queue computes the order; you land it), agent-to-agent messaging, and a general automation layer. Plot coordinates work on a plan. It is not trying to be the place your agents live.

## Skills

| Skill | Description |
|-------|-------------|
| [plot](skills/plot/) | Hub & dispatcher — reads git state, suggests next action |
| [plot-init](skills/plot-init/) | Adopt Plot in a repo — detects your setup and proposes the config |
| [plot-board-setup](skills/plot-board-setup/) | Set up the local Kanban board — checks prerequisites, records config, proves it serves |
| [plot-idea](skills/plot-idea/) | Create a plan: idea branch, plan file, and draft PR |
| [plot-approve](skills/plot-approve/) | Record the plan's approval through its declared review channel |
| [plot-implement](skills/plot-implement/) | Start/resume implementation: staleness preflight, branch setup, hand-off brief |
| [plot-deliver](skills/plot-deliver/) | Verify implementation complete, archive the plan |
| [plot-reconcile](skills/plot-reconcile/) | Read-only hygiene sweep — surface plan/symlink/branch drift with remediating commands |
| [plot-release](skills/plot-release/) | Create versioned release from delivered plans |
| [plot-sprint](skills/plot-sprint/) | Time-boxed sprint coordination with MoSCoW prioritization |
| [plot-dispatch](skills/plot-dispatch/) | Fan out a plan across several agents — one worktree and one worker per eligible branch |
| [plot-merge-queue](skills/plot-merge-queue/) | Safe merge order for finished branches, with collision prediction |
| [plot-fleet](skills/plot-fleet/) | Fleet pulse — which branch waves are eligible to start, which branches are claimed |
| [plot-reslice](skills/plot-reslice/) | Slice a multi-branch wave into one wave per branch — proposes named waves in an argued order, a person confirms |
| [ralph-plot-sprint](skills/ralph-plot-sprint/) | Automated sprint runner (extension) |
| [challenge-the-plan](skills/challenge-the-plan/) | Deep plan interrogation — adaptive interviews across technical, domain, UX, non-functional dimensions (companion) |
| [story-tracking](skills/story-tracking/) | Multi-session work tracking in markdown folders (companion — stories are the long-running umbrella around plans) |
| [tracer-bullets](skills/tracer-bullets/) | Thin vertical slice strategy (companion — usable standalone, referenced by `/plot-approve`) |

## Installation

### As a Claude Code plugin (recommended — auto-updates)

```
/plugin marketplace add plot-pm/plot
```

```
/plugin install plot@plot-marketplace
```

Skills auto-update when you run `/plugin update`.

### Via skills CLI

```bash
pnpx skills add https://github.com/plot-pm/plot.git --global --agent claude-code --all --yes
```

### Manual (single skill)

```bash
ln -s ~/CODE/plot/skills/plot ~/.claude/skills/plot
```

## Setup

Add a `## Plot Config` section to your project's `CLAUDE.md`:

```markdown
## Plot Config

- Plan directory: `docs/plans/`
- Sprint directory: `docs/sprints/`
- Branch prefixes: `idea/`, `feature/`, `bug/`, `docs/`, `infra/`
- Active symlink: `docs/plans/active/`
- Delivered symlink: `docs/plans/delivered/`
```

Plot discovers and adapts to whatever conventions your project provides. No hardcoded paths.

## Companion skills

- **[challenge-the-plan](skills/challenge-the-plan/)** — Deep plan interrogation via adaptive interviews. The design-phase companion: idea → **challenge** → optional tracer → approve. Works on any PLAN/SPEC/STORY file; adopted from [quatico-solutions/agent-skills](https://github.com/quatico-solutions/agent-skills).
- **[story-tracking](skills/story-tracking/)** — Multi-session work tracking in markdown folders (`docs/stories/`). Stories are the long-running umbrella (research, decisions, session narrative); plans are the approved, actionable units — they reference each other. Usable standalone; adopted from [quatico-solutions/agent-skills](https://github.com/quatico-solutions/agent-skills).
- **[tracer-bullets](skills/tracer-bullets/)** — Thin vertical slice strategy. Referenced by `/plot-approve` heuristics for work with technical uncertainty. Bundled with the plugin; usable standalone — it is a companion, not a lifecycle phase.

## Stories

Long-running work spanning several plans. Stories carry the intent and the
decision record; plans carry the approved, actionable units.

| Story | Status | About |
|-------|--------|-------|
| [plot-board](docs/stories/plot-board/STORY-plot-board.md) | active | Making parallel work visible — the board, the fleet, and the agent view |
| [plot-gates](docs/stories/plot-gates/STORY-plot-gates.md) | active | Rules that do not enforce themselves — converting Plot's stated requirements into checkable ones |
| [plot-planning-model](docs/stories/plot-planning-model/STORY-plot-planning-model.md) | active | How Plot cuts work into pieces — stories, plans, waves, sprints and what each one answers |
| [plot-in-a-customer-team](docs/stories/plot-in-a-customer-team/STORY-plot-in-a-customer-team.md) | draft | The board sees one repository — a four-repo customer estate, and what it could not show |
| [plot-agent-identity](docs/stories/plot-agent-identity/STORY-plot-agent-identity.md) | draft | An agent is someone, not something running — agent specs in git, and capacity that knows one kind of agent from another |
| [plot-plan-economics](docs/stories/plot-plan-economics/STORY-plot-plan-economics.md) | draft | What a plan costs, and what the approval was worth — measured cost against the value a human's interrogation records |
| [the-board-is-blank-where-it-matters](docs/stories/the-board-is-blank-where-it-matters/STORY-the-board-is-blank-where-it-matters.md) | active | An enterprise team's ticket inbox and build status are empty — and empty reads as a fact about their work |
| [setup-asks-what-the-repo-already-knows](docs/stories/setup-asks-what-the-repo-already-knows/STORY-setup-asks-what-the-repo-already-knows.md) | active | Setup asks what the origin URL and the Jenkinsfile already answer — then records a key nothing reads |

## Design

See [MANIFESTO.md](skills/plot/MANIFESTO.md) for Plot's founding principles and design philosophy.

See [changelog.md](skills/plot/changelog.md) for the complete evolution history.

## License

MIT
