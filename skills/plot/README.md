# plot

Git-native planning workflow for Claude Code.

## Purpose

Plot replaces issue trackers with git-native planning: markdown plan files on branches, PRs as workflow metadata, and git as the single source of truth. Plans merge to main before implementation begins, so all implementation branches reference a stable document. One plan can spawn multiple parallel implementation branches for concurrent work by different team members or agents in worktrees.

## Structure

| Path | Purpose |
|------|---------|
| `plot/SKILL.md` | Hub: overview, lifecycle diagrams, setup, phases, conventions, guardrails, dispatcher |
| `plot-idea/SKILL.md` | Create plan: idea branch + plan file + draft PR (8 steps) |
| `plot-approve/SKILL.md` | Approve plan: merge PR, fan out impl branches/PRs (8 steps) |
| `plot-deliver/SKILL.md` | Deliver: verify all impl PRs merged, completeness check, deliver (9 steps) |
| `plot-release/SKILL.md` | Release: verify readiness, cross-check notes, guide release (6 steps) |
| `plot-sprint/SKILL.md` | Sprint: time-boxed coordination with MoSCoW priorities (5 subcommands) |
| `plot/scripts/plot-pr-state.sh` | Helper: query plan PR state (draft/ready/merged/closed) |
| `plot/scripts/plot-impl-status.sh` | Helper: query all impl PR states for a slug from plan on main |
| `plot/scripts/plot-review-status.sh` | Helper: check review freshness for sprint items |
| `plot/scripts/plot-update-board.sh` | Helper: update GitHub Projects board status for a PR |
| `plot/scripts/board/board-server.mjs` | Local Kanban status board — built artifact of `@plot-pm/board` (run via `pnpm board`; rebuild via `pnpm build:board`) |
| `plot/changelog.md` | Complete evolution history across 5 development sessions |
| **Sibling skills** | |
| `tracer-bullets/SKILL.md` | Thin vertical slice strategy — referenced by `/plot-approve` heuristics and plan template |

## Tier

**Reusable / Publishable** — fully project-agnostic. Adopting projects configure via a `## Plot Config` section in their `CLAUDE.md`.

## Core Design Principles

1. **Commands not code** — Plot's workflow commands are skill markdown that an AI agent interprets and adapts to edge cases. Separate helper scripts handle mechanical data gathering (structured output any model can parse). Skills interpret and adapt; scripts collect and report.

2. **Plans merge before implementation** — The plan file lands on main first, so all implementation branches reference a stable document. This was the key design insight that solved the "can't merge until fully implemented" problem.

3. **One plan, many branches** — A single approved idea can spawn multiple implementation PRs. Parallel work by different team members, agents, or worktrees.

4. **Board is just a PR viewer** — No GitHub Issues, no separate tracker. The GitHub Projects board reflects PR state automatically. All planning happens in git.

5. **Approval metadata on branches** — Each implementation branch carries the plan file with approval context (timestamp, approver, assignee), providing both a meaningful first commit and traceability.

6. **Plans stay in place** — `YYYY-MM-DD-slug.md` files never move. Symlink dirs (`active/`, `delivered/`) provide filtered views. Links never break.

7. **Smart defaults** — Commands discover context (open PRs, active plans) rather than demanding exact input. Missing arguments trigger helpful suggestions, not errors.

8. **Phase guardrails** — Each command checks the current phase before acting. Cannot approve an unreviewed draft. Cannot deliver with open PRs. Cannot release undelivered work.

9. **Small models welcome** — Three model tiers: small (Haiku) for mechanical steps, mid (Sonnet) for heuristic reasoning, frontier (Opus) for deep judgment. Each skill has a Model Guidance table mapping steps to tiers. Steps degrade gracefully — smaller models ask humans where larger models decide autonomously.

## Roles

Plot recognizes three roles in the development workflow:

- **Decision maker** — Reviews plans, approves work, decides when to release, signs off on verification. **Always human.** Agents never make decisions — they surface information and suggest, humans decide.
- **Process facilitator** — Reads git state, suggests next actions, provides summaries. This is the `/plot` dispatcher role. Can be a human running scripts or an AI interpreting skills.
- **Implementer** — Writes code, creates PRs, does the actual work. Human developers, AI coding agents, or both.

Facilitation and implementation can be human or AI. Decisions are always human.

## Testing

Validated end-to-end twice in the originating project:

- **test-plot (v1):** Full lifecycle — `/plot-idea` through `/plot-ship`. Found and fixed 4 issues: empty branches on approve, undated archive names, missing input guidance, draft PR merge failures. PRs #9, #11, #12.

- **test-v2:** Full 4-phase lifecycle — Draft through Released. Verified the v2 refactoring works: dispatcher, deliver/release commands, helper scripts, lifecycle phases. Fixed impl-status script (reads from `origin/main`, not CWD) and release tag creation (annotated tags required). PRs #17, #18, release v0.1.1.

Additionally used for real work: planned and delivered BDD test coverage via `/plot-idea development` through `/plot-deliver development` (PR #14).

## Provenance

Originated in a private project across 5 Claude Code sessions on 2026-02-07:

1. **Session 1** (b65c7972) — Initial GitHub workflow setup: `/idea` command, Kanban board, draft PR convention.
2. **Session 2** (9e498b8f) — Plot redesign: 3-command system, "plans merge first" insight, naming.
3. **Session 3** (507ecfe3) — E2E test v1: 4 critical fixes.
4. **Session 4** — Plot v2 refactoring (PR #16): skills migration, dispatcher, `/plot-deliver`, `/plot-release`, lifecycle phases, helper scripts, Mermaid diagrams, guardrails.
5. **Session 5** — E2E test v2: full 4-phase lifecycle, script fixes, v0.1.1 release.

Migrated to standalone skills in this repo. Each command (`plot`, `plot-idea`, `plot-approve`, `plot-deliver`, `plot-release`) is its own skill directory with `SKILL.md`. Helper scripts and shared docs live in `plot/`.

See [changelog.md](./changelog.md) for the complete evolution history (commit hashes and PR numbers reference the private originating project, not this repo).

## Known Gaps

- Helper script paths are relative (`./scripts/`) — works when skill is installed via symlink but may need adjustment for other installation methods.
- No automated test suite; validation is manual via end-to-end lifecycle testing.
- No multi-repo support; plans and implementation must be in the same repository.
- Completeness verification in `/plot-deliver` relies on LLM judgment of PR diffs against plan deliverables.

## Planned Improvements

- CI integration: pre-commit hooks to validate plan file format.
- Plan templates: configurable templates for different plan types (feature, bug, docs, infra).
- Team review workflows: assignment and review rotation for plan PRs.
- Cross-repo planning: plans in a central repo with implementation in multiple repos.
