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
/plot-approve          Merge plan to main, fan out implementation branches
     |
   Implement           Parallel work on feature/bug/docs/infra branches
     |
/plot-deliver          Verify all impl PRs merged, archive plan
     |
/plot-release          Cut versioned release with changelog
```

Sprints (`/plot-sprint`) are orthogonal — they group plans by schedule, not by workflow phase.

New to Plot? Read [Intro to Using Plot](skills/plot/intro-to-using-plot.md) for a walkthrough of the lifecycle.

## Skills

| Skill | Description |
|-------|-------------|
| [plot](skills/plot/) | Hub & dispatcher — reads git state, suggests next action |
| [plot-idea](skills/plot-idea/) | Create a plan: idea branch, plan file, and draft PR |
| [plot-approve](skills/plot-approve/) | Merge approved plan, fan out into implementation branches |
| [plot-deliver](skills/plot-deliver/) | Verify implementation complete, archive the plan |
| [plot-release](skills/plot-release/) | Create versioned release from delivered plans |
| [plot-sprint](skills/plot-sprint/) | Time-boxed sprint coordination with MoSCoW prioritization |
| [ralph-plot-sprint](skills/ralph-plot-sprint/) | Automated sprint runner (extension) |
| [tracer-bullets](skills/tracer-bullets/) | Thin vertical slice strategy (companion — usable standalone, referenced by `/plot-approve`) |

## Installation

### As a Claude Code plugin (recommended — auto-updates)

```
/plugin marketplace add eins78/plot
```

```
/plugin install plot@plot-marketplace
```

Skills auto-update when you run `/plugin update`.

### Via skills CLI

```bash
pnpx skills add https://github.com/eins78/plot.git --global --agent claude-code --all --yes
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

- **[tracer-bullets](skills/tracer-bullets/)** — Thin vertical slice strategy. Referenced by `/plot-approve` heuristics for work with technical uncertainty. Bundled with the plugin; usable standalone — it is a companion, not a lifecycle phase.

## Design

See [MANIFESTO.md](skills/plot/MANIFESTO.md) for Plot's founding principles and design philosophy.

See [changelog.md](skills/plot/changelog.md) for the complete evolution history.

## License

MIT
