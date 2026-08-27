<p align="center">
  <img src="assets/logo.svg" alt="Plot logo" width="160">
</p>

# Plot

**Git-native planning for teams working with AI agents.**

Plans are markdown files — written, reviewed and versioned like source code. They live on branches, merge through pull requests, and never move. No database, no sync API, no second place where the truth might be.

---

## Why

One agent, one terminal, was easy. You watched it work. Who was doing what was not a question, because there was only one answer.

Once five agents run at the same time, **the scarce resource is no longer execution — it is knowing what is happening.** Agents take branches on their own, run detached, and outlive your session. It becomes normal for nobody to be watching. And leverage cuts both ways: a vague plan used to cost a developer a day. Now it costs twelve parallel branches, twelve pull requests and twelve reviews.

That shifts the bottleneck from hands to head. What limits delivery is no longer how fast anyone types, but **how many good decisions one person makes without losing the thread** — which is why Plot puts its weight on the moments a human decides, and gets out of the way everywhere else.

Three things follow, and they are the whole design:

- **What you approved is what ships.** The plan freezes at approval and stays in the repo, so what was agreed can be compared against what merged — months later, by anyone.
- **Parallel work needs no supervision.** Agents claim branches through git itself. Two agents cannot quietly redo each other's work.
- **Throughput never outruns review.** A tool computes the safe merge order; a person still lands it. That is the last checkpoint, and it is deliberate.

Every step is something you could do by hand. Claiming a branch is `git push`. Giving an agent a workspace is `git worktree add`. Checking what is in flight is reading refs. **That is also the exit:** stop using Plot and your plans are still markdown, your claims are still branches. There is nothing to migrate.

---

## Start here

Install as a Claude Code plugin:

```
/plugin marketplace add plot-pm/plot
/plugin install plot@plot-marketplace
```

Then, in the repo you want to use it in:

```
/plot-init
```

`/plot-init` reads what your repository already is — its branch naming, its git host, its CI, its existing planning docs — and proposes a `## Plot Config` block for your `CLAUDE.md` from that. It asks rather than assumes, and creates the plan skeleton once you agree.

Your first plan:

```
/plot-idea      write it        →  a plan file on an idea branch, with a draft PR
/plot-approve   agree to it     →  the plan merges and freezes
/plot-implement build it        →  branches, worktrees, hand-off briefs
/plot-deliver   check it landed →  every branch merged, plan delivered
```

Optional, and worth it once several branches are in flight: `/plot-board-setup` gives you a local board (`pnpm board`) that shows what is waiting on you.

**New to Plot?** [Intro to Using Plot](skills/plot/intro-to-using-plot.md) walks the whole lifecycle with real commands and output.

---

## Lifecycle

Four phases, four artefacts. Each transition is recorded in the plan itself — who, when, through which channel — so no phase boundary needs a tool beside it to know where things stand.

```
   Draft  ──────────  /plot-idea       plan file, idea branch, draft PR
     │
     │                challenge-the-plan (optional) — interrogate before agreeing
     │
     ├─ /plot-approve  ⏳ a human agrees. The plan freezes here.
     ▼
 Approved ──────────  /plot-implement  branches, worktrees, briefs
     │
     │                /plot-dispatch · /plot-fleet · /plot-merge-queue
     │                agents work; you land what comes back
     │
     ├─ /plot-deliver  every branch merged
     ▼
Delivered ─────────── ⚡ ── /plot-reject moves it back if something was missed
     │
     ├─ /plot-release  ⏳ a human decides to ship
     ▼
 Released
```

Guardrails are enforced, not suggested: you cannot approve an unreviewed draft, deliver with open implementation PRs, or release undelivered work.

Sprints (`/plot-sprint`) are orthogonal — they group plans by schedule, not by phase. A plan belongs to exactly one story and sits in no sprint or one.

---

## Several agents, one plan

An approved plan usually decomposes into several branches. Handing them to several agents at once raises two questions that hand-coordination answers badly: **which branches may run concurrently**, and **how does one agent take a branch without another taking it too**.

Plot answers both without adding a database.

**Waves.** Branches grouped under a `### ` subheading may run at the same time; a wave opens once every branch in every earlier wave is merged. So a tracer bullet proves the risky seam, then the rest fan out — the dependency real work actually has, without a dependency graph nobody keeps accurate. A plan with no subheadings is one wave.

**Claim-by-ref.** An agent takes a branch by pushing a claim commit to it. Two independent claims diverge, so the loser's push is rejected as non-fast-forward and exactly one agent wins. **Git is the lock** — no lock manager, no lease, no coordination file, nothing to fall out of sync. (The commit matters: a branch merely pointing at `main` does not diverge from it, so both pushes would succeed and both agents would think they held it. Plot never force-pushes, which is the other half of why the lock holds.)

**No database is the feature, not the omission.** Orchestrators usually need one because their tickets have no home. Plot's plans *are* the work table and its branches *are* the claims — so there is no second store to fall out of sync with git, and no state that survives being wrong. A killed dispatcher or a dead worker costs nothing: the next read re-derives the truth.

### The fleet commands, and the failure each one removes

**`/plot-fleet` — a dead agent and a slow one look identical from outside.** Re-reads git every run and reports which waves are complete, eligible or blocked, and which branches are claimed. It also surfaces a blocker that only exists once work is parallel — *approved, and nobody has taken it* — which no ticket board has a column for. Read-only.

**`/plot-dispatch` — fanning out is a decision, not a mechanical step.** Gives each eligible branch its own worktree and a detached worker, each claimed by ref push. Deliberately a command you run rather than something on a timer, because four agents mean four pull requests somebody has to read.

**`/plot-merge-queue` — every branch merges into `main` cleanly on its own, and two of them still break each other.** Names the safe order and flags which branches collide with one ahead of them. That failure is invisible to per-branch CI by construction: each branch is tested against `main`, never against its siblings.

**`/plot-reslice` — a wave holding several branches cannot be claimed atomically.** The claim is a push to *one* branch, so a wave with three has no single thing to win. Proposes one wave per branch in an argued order; a person confirms before anything is rewritten.

**`/plot-reconcile` — derived state is honest, but the estate still drifts.** A read-only sweep for phase/index disagreement, merged-but-undelivered work and stale branches. Prints the remediating commands; you decide what to run.

### The board sorts by whose turn it is

Each command above answers a question in a terminal, once, and the answer is gone when the scrollback rolls. The board (`pnpm board`) is where it stays — organised around a different question than a ticket board asks.

| Section | What is in it | What it asks of you |
|---------|---------------|---------------------|
| **WAITING ON YOU** | Your actual queue | Act. The only section that needs you. |
| **WORKING** | Agents implementing now | Nothing. Just look. |
| **WAITING ON A MACHINE** | CI, merges, pushes in flight | Nothing — unless it is stuck. |
| **NOT STARTED** | Approved, nobody has taken it | Dispatch it, or decide it waits. |
| **QUIET** / **DONE** | Idle, and finished | Nothing. |

Only the top section carries your name. **The length of "waiting on you" is your real WIP limit** — not the number of open tickets, which with a fleet running stops measuring anything a human controls.

Everything shown is derived from git on a timer, so the board never becomes a second source of truth. It can also act — approve, dispatch, deliver, reslice — but each action runs the same skill you would have run in the terminal, and the write endpoints are bound to loopback.

### Why merging stays yours

| Speed | What belongs here | Why |
|-------|-------------------|-----|
| **Automate** | Creating branches, moving symlinks, cutting an RC tag, watching the fleet | Mechanical, no judgement. Waiting is waste. |
| **Let it run** | Implementing a branch, writing a plan, working a checklist | Where the work happens. Not bottlenecks — the point. |
| **Never accelerate** | Approving a plan, fanning out a fleet, deciding to release, **merging** | Each multiplies what follows it. |

Merging sits in the third row even though `/plot-merge-queue` has already computed the collision-free order. **Automating the order removes guesswork; automating the landing would remove the last checkpoint** in a flow that has just multiplied its throughput.

Start with [Working several branches at once](skills/plot/intro-to-using-plot.md#working-several-branches-at-once).

---

## Configuration

Plot hardcodes no paths. It reads a `## Plot Config` section in your `CLAUDE.md` and adapts to whatever conventions your project already has — `/plot-init` proposes that block for you.

The keys cover plan and sprint directories, branch prefixes, git host and CI, the tracker you read issues from, and how the fleet runs its workers. **The full reference lives in [`plot-config.sh`](skills/plot/scripts/plot-config.sh)**, beside the parser that reads it, so it cannot drift from what is actually supported.

---

## Skills

| Skill | Description |
|-------|-------------|
| [plot](skills/plot/) | Hub & dispatcher — reads git state, suggests next action |
| [plot-init](skills/plot-init/) | Adopt Plot in a repo — probes your setup and proposes the config |
| [plot-board-setup](skills/plot-board-setup/) | Set up the local board — checks prerequisites, records config, proves it serves |
| [plot-idea](skills/plot-idea/) | Create a plan: idea branch, plan file, draft PR |
| [plot-approve](skills/plot-approve/) | Record the plan's approval through its declared review channel |
| [plot-implement](skills/plot-implement/) | Start/resume implementation: preflight, branch setup, hand-off brief |
| [plot-deliver](skills/plot-deliver/) | Verify implementation complete, deliver the plan |
| [plot-reject](skills/plot-reject/) | Move a prematurely delivered plan back to Approved |
| [plot-reconcile](skills/plot-reconcile/) | Read-only hygiene sweep — plan/branch drift with remediating commands |
| [plot-release](skills/plot-release/) | Cut a versioned release from delivered plans |
| [plot-sprint](skills/plot-sprint/) | Time-boxed sprint coordination with MoSCoW prioritization |
| [plot-dispatch](skills/plot-dispatch/) | Fan out a plan — one worktree and one worker per eligible branch |
| [plot-fleet](skills/plot-fleet/) | Fleet pulse — which waves are eligible, which branches are claimed |
| [plot-merge-queue](skills/plot-merge-queue/) | Safe merge order with collision prediction |
| [plot-reslice](skills/plot-reslice/) | Slice a multi-branch wave into one wave per branch |
| [ralph-plot-sprint](skills/ralph-plot-sprint/) | Automated sprint runner (extension) |

### Companions

Usable standalone — they are not lifecycle phases.

- **[challenge-the-plan](skills/challenge-the-plan/)** — Deep plan interrogation via adaptive interviews. The design-phase companion: idea → **challenge** → optional tracer → approve. Works on any PLAN/SPEC/STORY file.
- **[story-tracking](skills/story-tracking/)** — Multi-session work tracking in markdown folders. Stories are the long-running umbrella (research, decisions, session narrative); plans are the approved, actionable units.
- **[tracer-bullets](skills/tracer-bullets/)** — Thin vertical slice strategy, referenced by `/plot-approve` for work carrying technical uncertainty.

Both companions were adopted from [quatico-solutions/agent-skills](https://github.com/quatico-solutions/agent-skills).

### Other ways to install

```bash
# skills CLI
pnpx skills add https://github.com/plot-pm/plot.git --global --agent claude-code --all --yes

# single skill, by hand
ln -s ~/CODE/plot/skills/plot ~/.claude/skills/plot
```

The plugin auto-updates with `/plugin update`.

---

## Stories

Long-running work spanning several plans. Stories carry the intent and the decision record; plans carry the approved, actionable units — they reference each other.

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

---

## Design

[MANIFESTO.md](skills/plot/MANIFESTO.md) — founding principles and the nine questions every change is tested against.

[changelog.md](skills/plot/changelog.md) — the complete evolution history.

## License

MIT
