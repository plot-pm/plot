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

## Architecture

Plot is a hub-and-spoke skill system:

| Role | Skill | Purpose |
|------|-------|---------|
| Hub | `plot/` | Dispatcher — reads git state, suggests next action |
| Command | `plot-idea/` | Create plan with ceremony matched to the change (two-question triage, posture gates) |
| Command | `plot-approve/` | Record the plan's approval through its declared review channel — and stop |
| Command | `plot-implement/` | Start/resume implementation: staleness preflight, branch setup, hand-off brief, Started record |
| Command | `plot-deliver/` | Verify all impl PRs merged (cross-repo aware), deliver the plan |
| Command | `plot-release/` | Cut versioned release with changelog |
| Coordination | `plot-sprint/` | Time-boxed sprint with MoSCoW priorities |
| Automation | `ralph-plot-sprint/` | Automated sprint runner (shell loop wrapper) |
| Companion | `challenge-the-plan/` | Deep plan interrogation (design-phase: idea → challenge → approve) — usable standalone, not a plot spoke |
| Companion | `story-tracking/` | Multi-session work tracking (stories = umbrella around plans) — usable standalone, not a plot spoke |
| Companion | `tracer-bullets/` | Thin vertical slice strategy — usable standalone, not a plot spoke |

Spoke commands reference helper scripts via relative path: `../plot/scripts/plot-pr-state.sh`.

## Helper Scripts

Scripts in `skills/plot/scripts/` that any model tier can use:

| Script | Purpose |
|--------|---------|
| `plot-pr-state.sh` | Query plan PR state (draft/ready/merged/closed), asked through `plot-host.sh` so it answers on Bitbucket too. Reports `mergeCommit` rather than `mergedAt` |
| `plot-impl-status.sh` | Query all implementation PR states for a slug |
| `plot-review-status.sh` | Check review freshness for sprint items |
| `plot-update-board.sh` | Update GitHub Projects board status for a PR |
| `plot-plan-meta.sh` | Parse plan files → JSON (phase, type, title, sprint, story, assignee, branches, PRs, `Review:`/`Impl:` ceremony answers, `Approved:`/`Started:` transition records); the plan-format contract |
| `plot-config.sh` | Read a `## Plot Config` key with a default (`get <key> [default]`); includes the optional `Plan template` override key and the Plot 2 posture keys (`Plan PRs`, `Implementation home`, `Hosts plans`, `Tracker`, `Git host`) |
| `plot-host.sh` | Git-host adapter (gh/bb): `backend`, `default-branch`, `pr-state`, `pr-create`, `pr-merge`, `pr-list`, `pr-body` — the ONE place that talks to the host CLI |
| `plot-phase-gate.sh` | PreToolUse hook (see `hooks/hooks.json`): blocks implementation commits while the governing plan is Draft; plan-only commits pass; fails open |
| `plot-story-lint.sh` | Story-estate drift check (missing STORY files, frontmatter, done-not-archived, index sync); machine-countable footer; exit 1 on findings |
| `plot-reconcile-scan.sh` | Read-only plan/branch drift sweep (five sections + machine-countable footer) |
| `board/board-server.mjs` | Local Kanban status board — built artifact of `@plot-pm/board` (`packages/board`); run via `pnpm board`, rebuild via `pnpm build:board` |

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

Plot contains zero hardcoded project names, paths, or configuration. Adopting projects describe their conventions in a `## Plot Config` section of their `AGENTS.md`. Plot discovers and adapts — never enforces.

## Skill Authoring

- Each skill directory: `SKILL.md` (frontmatter + instructions) + `README.md` (dev docs, required)
- **Use `/writing-skills`** when planning, creating, editing, or reviewing skills
- Progressive disclosure: overview in SKILL.md, details in referenced files
- Third person ("Processes files" not "I help you process files")
- Keep skills generic — no account-specific data
- When skills say "ask the user", use `AskUserQuestion` (Codex) / `ask_question` (Cursor)
- Keep the root README.md skills table in sync

## Gates Over Rules

**For important agent behaviors, always implement gates, not rules.** ([Reference](https://blog.fsck.com/2026/04/07/rules-and-gates/))

- A **rule** is a guideline the agent can rationalize around. Rules live in `AGENTS.md` or skill instructions and depend on the agent choosing to follow them.
- A **gate** is a hard stop with objective verification — enforced via hooks (PreToolUse / PostToolUse) where the agent cannot proceed without meeting a concrete, checkable condition.
- **The test:** Can you answer "Did I complete this?" without actually doing the work? If yes, it's a rule. If no, it's a gate.

When writing skills that include critical workflows (phase guardrails, branch creation, PR state checks, destructive operations), prefer gates via hooks over prose-only instructions. Even when the user casually says "add a rule for X," evaluate whether it should be a gate and implement accordingly.

**Skill authors:** If your skill includes a "MUST" or "NEVER" instruction, ask: is this enforced by a hook, or just written in prose? If prose-only, it's a rule and will eventually be violated. Convert critical MUSTs to gates.

**Examples in plot:**
- The four phase guardrails (cannot approve unreviewed draft, cannot deliver with open impl PRs, cannot release undelivered work, etc.) are currently rules embedded in spoke commands. Stronger forms would be gates: a PreToolUse hook on `gh pr merge` that reads the plan's phase and blocks merges that violate the lifecycle.
- The "always run `pnpm test`" instruction in Testing above is a rule — a candidate for a gate via a pre-commit / pre-push hook.

## Testing

Plot is a pnpm workspace: the skills live at the repo root, and the board is a
package under `packages/`.

```bash
pnpm install         # install dependencies first if node_modules is missing
pnpm test            # validates all skills parse correctly
pnpm run test:reconcile   # plan-format contract tests (plot-plan-meta.sh)
pnpm run test:board       # rebuilds the board artifact + runs its tests
pnpm run typecheck        # typechecks @plot-pm/board

pnpm run test:e2e         # lifecycle choreography in sandbox repos — CI's job,
                          # NOT part of a local run. See below.
```

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

**Always install dependencies and run tests.** If `pnpm test` fails due to missing `node_modules`, install them and retry — never skip tests or dismiss the failure.

**The board is first-class.** Keeping it working — and considering board impact when planning changes to the plan format, template, helper scripts, or `docs/plans` layout — is part of the [Definition of Done](docs/definition-of-done.md), gated in CI.

**On a conflict in `board-server.mjs`, do not read the diff.** It is generated output marked `-merge` in `.gitattributes`, so git keeps one version whole rather than splicing markers into it. Take **either** side, run `pnpm build:board`, and commit the result — the rebuild overwrites whichever side was kept, so the choice cannot matter. Never phrase it as "take ours": *ours* inverts between `git merge` and `git rebase`. Full procedure: [Definition of Done › Resolving a board artifact conflict](docs/definition-of-done.md#resolving-a-board-artifact-conflict).

**Behavioral testing is manual.** The skills have no unit tests — validation is via end-to-end lifecycle testing (full workflow from `/plot-idea` through `/plot-release`). Any change to a spoke command or helper script should be tested with a full lifecycle walkthrough. See `skills/plot/README.md` for documented test runs. (The board, being real code, does have automated tests.)

## Contributing

- **Issues:** https://github.com/plot-pm/plot/issues
- **Decision criteria:** Does the change pass the [manifesto's 9-question checklist](skills/plot/MANIFESTO.md#making-decisions)?
- **Known gaps & improvements:** tracked in `skills/plot/README.md`
- **Evolution history:** `skills/plot/changelog.md`

## Versioning

Every skill MUST have a `metadata.version` field in its SKILL.md frontmatter.

**When a skill is changed, increment its version** (semver):

- **Patch** (`x.y.Z`): bug fixes, wording improvements, minor clarifications
- **Minor** (`x.Y.0`): new sections, new patterns, expanded coverage
- **Major** (`X.0.0`): structural reorganization, removed sections, breaking workflow changes

**When any skill version is bumped, bump the plugin version** in all 3 metadata files (`package.json`, `.Codex-plugin/plugin.json`, `.Codex-plugin/marketplace.json`):

- Skill patch → plugin patch (at minimum)
- Skill minor → plugin minor (at minimum)
- Skill major → plugin major

## Commit Conventions

- `plot: <description>` — hub skill or cross-cutting changes
- `plot-<command>: <description>` — spoke-specific changes (e.g., `plot-approve: fix branch creation`)
- Plain description — repo-level files (README, AGENTS.md, plugin metadata)

## Status

Version 1.0.0-beta.3. Experimental, evolving through real-world usage. Originated 2026-02-07 across 5 Codex sessions in a private project; migrated to this standalone repo 2026-03-13.
