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

**Claim-by-ref.** An agent takes a branch by pushing an empty ref for it. Git rejects a push that would overwrite an existing branch, so a race has exactly one winner. **Git is the lock** — no lock manager, no lease, no coordination file, nothing to fall out of sync.

Everything else is derived from that. `/plot-fleet` re-reads git each time to report what is complete, eligible, or claimed; `/plot-dispatch` gives each eligible branch its own worktree and a detached worker; `/plot-merge-queue` says in what order the finished branches can land and which will collide with a branch ahead of it — the failure that is invisible when every branch merges into `main` cleanly on its own.

Because fleet state is derived and never stored, a killed dispatcher or a dead worker costs nothing: the next read re-derives the truth from git. And because merging stays with you, throughput never outruns review — the queue tells you the safe order, you decide what lands.

Start with [Working several branches at once](skills/plot/intro-to-using-plot.md#working-several-branches-at-once).

## Skills

| Skill | Description |
|-------|-------------|
| [plot](skills/plot/) | Hub & dispatcher — reads git state, suggests next action |
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

## Design

See [MANIFESTO.md](skills/plot/MANIFESTO.md) for Plot's founding principles and design philosophy.

See [changelog.md](skills/plot/changelog.md) for the complete evolution history.

## License

MIT
