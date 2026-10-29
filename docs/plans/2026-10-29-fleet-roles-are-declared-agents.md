# Fleet roles are declared agents

> fleetd starts every judgement step as a named role agent, so the hard rules that each brief repeats by hand live in one definition.

## Status

- **State:** Draft
- **Type:** infra
- **Issue:** #2898
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- The fleet starts its judgement steps as four declared role agents (reviewer, fixer, unblocker, main-repair) through the existing agent runner, and `/plot-init` gives an adopting repository the same four definitions.

<!-- Board impact: none expected. The plan format, the template, the helper scripts and the docs/plans layout do not change. A new caller identity on the `continue`, `restart` and `merge` controllers may reach the board's action endpoints; the first slice confirms this. -->

## Motivation

The delivery loop in [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka on 2026-10-29) needs fleetd to start agents for four judgement steps: review a PR, fix a finding, answer a `PLOT-BLOCKED` question and repair a red main. Today no `.claude/agents/` directory exists and nothing starts `claude --agent`. The master agent repeats the hard rules (never edit a gate, never join lines, bash 3.2, never commit a built bundle, never write "Fixes #N") in every brief by hand. A rule repeated by hand in each brief is a rule a brief can omit.

The three controllers that act on a blocked or dead desk (`continue`, `restart`, `merge`) refuse every unattended caller. A fleetd-started role runs unattended, so it cannot act until one caller identity is declared.

## Design

### Approach

The spec's *Role agents*, *Constraints* and *Calls made* sections bind this plan. In particular:

- Each role is a subagent definition in the repository's `.claude/agents/<role>.md`, not in the plugin, because plugin agents ignore `hooks` and `permissionMode`.
- There is one runner. `agentRunCommand` and the `agent-run` port take a role name and start `claude -p --agent <role>`. The reviewer keeps its charter `.plot/charters/reviewer.json`.
- Each definition sets the model, isolation, `maxTurns`, `memory: local` and the `PreToolUse` and `Stop` hooks that the spec's *Role agents* table names. `.claude/agent-memory-local/` is git-ignored.
- The layering rule holds: a controller calls the domain, the domain owns the port, and only an adapter starts the process.
- A declared fleetd caller identity is read by the `continue`, `restart` and `merge` controllers. Each lifts its unattended refusal only for that caller. `release` refuses every unattended caller.
- `/plot-init` provides the four definitions to an adopting repository.

| Role | Model | Isolation | Writes |
|---|---|---|---|
| reviewer | opus | read-only | the review record |
| fixer | opus | `worktree` | commits on the PR's branch |
| unblocker | sonnet | read-only | one answer through `continue` |
| main-repair | opus | `worktree` | a fix PR, or nothing |

Hooks gate a rule only where a grep can tell. The other rules stay instructions in the definition.

### Open Questions

- [ ] How does fleetd declare its caller identity: an environment variable, a flag or a signed marker file? The spec says only "an explicit caller identity the controller reads". The choice decides whether another unattended process can forge it.
- [ ] Which hook checks fit "never join lines" and "never commit built bundles"? `scripts/check-no-bundle-diff.sh` already covers the second.
- [ ] Does `/plot-init` copy the definitions or generate them from a shipped template? Copies drift; a template needs a version check.

## Slices

### Runner

- `feature/agent-run-takes-a-role` — `agentRunCommand` and the `agent-run` port take a role name and start `claude -p --agent <role>`; the reviewer starts through it. <!-- builds: agent-run role parameter on agentRunCommand -->

### Definitions

- `feature/role-agent-definitions` — the four `.claude/agents/*.md` files with their hooks, plus the `.gitignore` entry for `.claude/agent-memory-local/`. <!-- builds: reviewer.md, fixer.md, unblocker.md, main-repair.md -->

### Caller identity

- `feature/fleetd-caller-identity` — fleetd declares its caller identity; `continue`, `restart` and `merge` lift the unattended refusal for that caller only; `release` still refuses every unattended caller. <!-- builds: a declared fleetd caller identity -->

### Adoption

- `feature/plot-init-provides-role-agents` — `/plot-init` provides the four definitions to an adopting repository. <!-- builds: plot-init role-agent provisioning -->

## Notes

- Created from tracker issue #2898 by `/plot-idea` under `PLOT_UNATTENDED=1`. Type `infra` came from the prompt. The design question had no explicit answer, so the plan starts in Draft.
- Deliverable search: `agentRunCommand` exists in `packages/domain/src/adapters/agent-run/agent-run-command.ts` and is extended here, not duplicated. No existing `.claude/agents/` definitions or caller identity were found.
- The slice split is a proposal. The spec leaves "the exact split of the work into plans and slices" to the builder.
