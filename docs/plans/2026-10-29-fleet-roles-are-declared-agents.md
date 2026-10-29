# Fleet roles are declared agents

> fleetd starts every judgement step as a named role agent whose definition and gates come from the default branch, and the `merge`, `continue` and `release` controllers refuse every unattended caller except fleetd's own typed call.

## Status

- **State:** Approved
- **Type:** infra
- **Sprint:** delivery-loop
- **Issue:** #2898
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2908 merged
- **Started:** 2026-10-29, Jan Wloka, `feature/role-agents-are-probed`

## Changelog

- An unattended caller (`PLOT_UNATTENDED=1`) can no longer merge a PR, answer a desk through `continue`, or release; each controller refuses with `unattended`. fleetd's own in-process `merge`, `continue` and `restart` calls pass. `release` refuses fleetd too.
- fleetd starts the reviewer, fixer, unblocker and main-repair as role agents. Each role's definition and gates come from the default branch, so a PR cannot change the rules that its reviewer or fixer runs under.
- A fixer, unblocker or main-repair run cannot write a commit status, run a review, merge, push to the default branch, or edit `.claude/**` or a gate.
- `/plot-init` writes the four role definitions into an adopting repository where they are absent, and reports a differing copy instead of overwriting it.

<!-- Board impact: yes, small. The board's continue, restart, merge and release entrances pass a caller reading to the domain instead of a bare `unattended` flag, and refuse an unattended board process on `merge`, `continue` and `release`. The plan format, the template, the helper scripts and the docs/plans layout do not change. -->

## Motivation

The delivery loop in [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka on 2026-10-29) needs fleetd to start agents for four judgement steps: review a PR, fix a finding, answer a `PLOT-BLOCKED` question and repair a red main. Today no `.claude/agents/` directory exists and nothing starts `claude --agent`. The master agent repeats the hard rules (never edit a gate, never join lines, bash 3.2, never commit a built bundle, never write "Fixes #N") in every brief by hand. A rule repeated by hand in each brief is a rule a brief can omit.

**Only `restart` refuses an unattended caller today.** `restartWorker` refuses `unattended` (`packages/domain/src/workflows/dispatch-verbs.ts:194-198`) from a boolean reading (`:134-135`) that three entrances fill from their own environment: `packages/board/src/server/restart.ts:68`, `packages/fleet/src/server/entry/restart-command.ts:89` and `packages/fleet/src/server/entry/restart-stopped-command.ts:103`. `merge` takes no caller reading at all: `MergeRefusal` has no `unattended` reason (`packages/domain/src/workflows/merge.ts:11-19`), and a panel probe merged with no caller stated. `continue` refuses only `unknown-branch` and `no-worktree` (`packages/fleet/src/shared/continue-command.ts:78,86`); the `unattended` refusal in `continuation.ts:162-163` belongs to restart. `release` proceeds unattended by design: `release.ts:21` states "`PLOT_UNATTENDED` answers *may I ask?* and never *may I proceed?*", and `release.ts:239` turns the Should-Have prompt into a `PLOT-UNASKED` warning. So any unattended process, including every desk worker, can merge through `plot-ask.mjs merge`, answer a question through `continue`, and release. The design (*Role agents*, "Unattended callers") assumed these refusals existed; this plan builds them (D1).

**A definition read from the run's tree lets a PR rewrite its own reviewer.** `reviewerCommand` passes `--setting-sources user` (`packages/domain/src/rules/review-verdict.ts:179`) so that no setting from the reviewed tree applies, and the reviewer runs in a worktree at the PR's head (`packages/board/src/server/entry/review.ts:430`). Panel probes under Claude Code 2.1.312 measured three facts:

- `claude -p --setting-sources user --agent <name>` answers "`--agent '<name>'` not found"; adding `project` loads the agent and also the reviewed tree's hooks and settings.
- `--setting-sources user --agents <file outside the tree> --agent <name>` loads the agent.
- Under `--agent`, a `PreToolUse` hook in the definition's frontmatter did not fire and `isolation: worktree` was ignored (one run each); the same hook in `.claude/settings.json` blocked the call.

So the gates cannot live in the frontmatter, and the definition cannot come from the run's cwd.

**`--agent` does not belong in `agentRunCommand`.** The port names no harness-specific option (`packages/domain/src/ports/agent-run.ts:30`), and `agentRunCommand` runs whatever fragment the project configures with no CLI flag vocabulary (`packages/domain/src/adapters/agent-run/agent-run-command.ts:47,65`). `AgentRunRequest.role` already exists (`ports/agent-run.ts:48`), carries `worker`, `idea`, `brief` and `reviewer` (`review.ts:451`), and selects the SDK hand-back protocol (`packages/domain/src/adapters/agent-run/agent-run-sdk.ts:396`). A second adapter, `agentRunSdk`, runs the worker loop (`packages/fleet/src/server/entry/worker-loop.ts:2199`) with `settingSources: ['user', 'project', 'local']` (`agent-run-sdk.ts:423`). "One runner" means one port with two adapters.

**A non-reviewer role can bypass review without bypass rights.** `plot-host.sh commit-status` (`skills/plot/scripts/plot-host.sh:6039`) writes `plot/review` with the App key that any local process can read, and the controller gate allows every call from a linked worktree (`packages/board/src/server/entry/gate.ts:688`), including an unpinned `gh pr merge`.

This plan depends on no sibling plan. #2901, #2903, #2904, #2906 and #2907 depend on its slices.

## Design

### Approach

**Probe first.** Slice 1 runs `claude -p` with `--setting-sources user`, `--agents <file read from origin/<default>>` and `--settings <role settings file>`, and records in this plan whether: the agent loads; a `PreToolUse` hook in the settings file blocks a forbidden call; `maxTurns` in the definition bounds the run; and `memory: local` writes outside the run's tree. Slice 3 waits for the recorded result.

**Caller reading (D1).** The domain takes a typed `caller` reading in place of `unattended: boolean` on `restart`, and gains it on `merge`, `continue` and `release`.

- `merge`, `continue` and `restart` refuse `unattended` for every unattended caller except `fleetd`. `release` refuses every unattended caller, `fleetd` included; only the person's approval command reaches it (D7).
- fleetd calls `merge`, `continue` and `restart` in process with `caller: 'fleetd'`. No environment variable or marker file carries the identity, so nothing inherits it and no other process can set it. `SPAWN_CONTRACT` does not change, because no gate reads a new variable.
- The CLI and HTTP entrances keep reading `PLOT_UNATTENDED` into `caller: 'unattended'` and never produce `fleetd`. The entrances are the three restart entrances above, `plot-ask.mjs merge` and the board merge route, the board and fleet continue entrances, and the release routes (`plot-deliver.mjs --release`, `POST /api/release`).
- The new refusals stop desk workers and any agent under `PLOT_UNATTENDED=1` from merging, continuing or releasing. The comment at `release.ts:21` and the unattended arm at `:239` change with it.
- No role agent calls `merge` or `restart`. The unblocker returns its answer and fleetd calls `continue` with it (owner: #2901).

**Role definitions (D5).** A role is `.claude/agents/<role>.md` on the default branch, holding the prompt, the model and `maxTurns`, plus a per-role settings file that holds the gates as hooks.

- fleetd reads both from `origin/<default>` and passes them as `--agents <file>` and `--settings <file>`, written outside the run's tree. The run keeps `--setting-sources user`, so nothing from the reviewed or fixed tree applies.
- The hooks call arms of the existing `board/plot-gate.mjs` bundle, decided by domain rules beside `rules/controller-gate.ts`. No new `.sh` file is added under `skills/`.
- Every non-reviewer role denies `plot-host.sh commit-status`, `plot-review.mjs`, `gh pr merge` and `plot-ask.mjs merge`, a push to the default branch, and edits to `.claude/**`, `scripts/check-*.sh`, `skills/plot/scripts/*-gate.sh` and `.github/workflows/**`. A commit message carrying "Fixes #N" is denied.
- "Never commit a built bundle" stays with the existing gates (`plot-bundle-commit-gate.sh` at commit, `scripts/check-no-bundle-diff.sh` in CI). "Never join lines" and "bash 3.2" stay instructions; `check-bash32-syntax.sh` is already a local check.
- The reviewer definition holds no write tools. `review.ts` keeps the only `plot/review` write.
- `memory: local` writes outside the PR tree, at the path the probe records.
- fleetd creates every worktree itself; `isolation` in frontmatter is not relied on. The design's *Isolation* column becomes a runner input (`AgentRunRequest.worktree`).

| Role | Model | Tree | Writes |
|---|---|---|---|
| reviewer | opus | a detached worktree at the PR head, created by fleetd | nothing; `review.ts` writes the status |
| fixer | opus | a worktree on the PR's branch, created by fleetd | commits on the PR's branch |
| unblocker | sonnet | read-only | an answer that fleetd passes to `continue` |
| main-repair | opus | a worktree off the default branch, created by fleetd | a fix PR, or nothing |

**Role start.** A domain command builder beside `reviewerCommand` (`review-verdict.ts:157`) adds `--agent <role>`, `--agents <file>` and `--settings <file>` for a declared role name in a dedicated request field, not `role`. `agentRunCommand` stays fragment-agnostic, and today's `worker`, `idea`, `brief` and `reviewer` fragments stay byte for byte. `agentRunSdk` maps the same reading to its own options, or refuses a role it cannot load from the default branch. The start does not hold fleetd's tick, and a liveness reading answers whether a role run for a subject is still alive.

**Adoption.** `rules/adoption.ts` decides that an adopting repository gets the four definitions and settings files, and the performer writes them: absent files are written, an existing differing file is reported `stale` and never overwritten, and a second run writes nothing. A test holds this repository's copies equal to the shipped ones.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-fleet-roles-are-declared-agents/panel.md`):

- [x] D1: `merge`, `continue` and `release` refuse every unattended caller, as `restart` already does (`dispatch-verbs.ts:194`). The caller is a typed domain reading (`caller`), not an environment variable. fleetd calls `merge`, `continue` and `restart` in process with its typed caller, which those three accept; `release` accepts no unattended caller, fleetd included. This plan builds the refusals; the design's claim that they existed was wrong.
- [x] D5: a role is `.claude/agents/<role>.md` (prompt, model, `maxTurns`) loaded from the default branch's copy through `--agents <file>`, never from the reviewed or fixed tree, plus a per-role settings file passed with `--settings` that holds the gates. fleetd creates any worktree itself; `isolation` in frontmatter is not relied on. The first slice is a probe that proves this under `claude -p` before anything depends on it.
- [x] D7: the person's approval command runs the release finish as that person; fleetd never runs it. This is why `release` refuses fleetd's caller too.
- [x] The identity carrier: a typed argument for fleetd's in-process calls, and no carrier for a role, because no role is granted `merge` or `restart`.
- [x] Role definitions stay `.claude/agents/*.md` files, with the gates moved into a per-role settings file, rather than charters.
- [x] `/plot-init` provides the definitions through `rules/adoption.ts` and the performer: written where absent, never overwritten, a differing copy reported `stale`.

### Open Questions

- [ ] Which source names the reviewer's model and effort when both the charter (`.plot/charters/reviewer.json`, `"model": "opus"`) and `reviewer.md` name one? The built command must carry exactly one source.

## Slices

### Role-agent probe

- `feature/role-agents-are-probed` — a probe under `claude -p` that proves `--agents <file from main>` plus `--settings <role settings>` gates a tool call and loads under `--setting-sources user`; records the result, `maxTurns` and the `memory: local` path in this plan <!-- builds: a recorded role-agent probe --> → #2919

### Unattended refusals

- `feature/unattended-callers-are-refused` — the typed `caller` reading; `merge`, `continue` and `release` refuse an unattended caller; fleetd's typed caller is accepted by `merge`, `continue` and `restart` only; every entrance maps `PLOT_UNATTENDED` to `unattended` and never to `fleetd` <!-- builds: a caller reading on merge, continue, restart and release -->

### Role definitions

- `feature/role-agent-definitions` — the four definitions and per-role settings files; non-reviewer roles deny status writes, review runs, merges, pushes to main, and edits to `.claude/**` and the gates; `memory: local` outside the PR tree <!-- waits: feature/role-agents-are-probed --> <!-- builds: reviewer.md, fixer.md, unblocker.md, main-repair.md and their settings files -->

### Detached role start

- `feature/role-agents-start-detached` — the role name in a domain command builder beside `reviewerCommand`, a start that does not hold the tick, a liveness reading for a role run, both runner adapters <!-- builds: a role command builder and a role-run liveness reading -->

### Role adoption

- `feature/plot-init-provides-roles` — `rules/adoption.ts` provides the definitions to an adopter; absent files written, a differing copy reported `stale` <!-- builds: role-definition adoption -->

## Notes

- Created from tracker issue #2898 by `/plot-idea` under `PLOT_UNATTENDED=1`, and amended 2026-10-29 after panel round 1.
- Plans that depend on this one: #2901 (`feature/fleetd-answers-a-question` waits on `feature/role-agents-start-detached` and `feature/unattended-callers-are-refused`), #2903 (`feature/fleetd-starts-the-fixer`), #2904 (`feature/fleetd-starts-main-repair`), #2906 (its fixer start, through #2903) and #2907 (`feature/the-release-is-approved-once` waits on `feature/unattended-callers-are-refused`).
- This plan owns all four definition files, including `unblocker.md`; #2901 owns the per-question prompt fleetd passes to the unblocker.
- The fixer's in-flight mark and attempts record belong to #2903 (`feature/the-fixer-attempts-record`); this plan supplies only the role-run liveness reading.
- Starting the fixer, including where it works while a dead desk's worktree still holds the PR branch, belongs to #2903 (`feature/fleetd-starts-the-fixer`) and #2906 (`feature/ending-action-starts-a-fixer`).
- The `plot/review` status write stays in `review.ts`; the accepted `success` that names a ticket belongs to #2903 (`feature/an-unfixed-high-is-ticketed`).
- The release finish belongs to #2907 (`feature/the-release-is-approved-once`, D7); this plan builds only the `release` refusal.
- A restart under fleetd's caller still reads the branch's PR fresh from the host (`RestartReadings.pr`, `dispatch-verbs.ts:131`), never from the PR index.
