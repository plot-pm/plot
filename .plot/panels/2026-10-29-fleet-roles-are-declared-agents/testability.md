# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2898 (`gh issue view`), DESIGN-delivery-loop.md (*Role agents*, *Constraints*, *Calls made*), `adapters/agent-run/agent-run-command.ts`, `ports/agent-run.ts`, `adapters/agent-run/agent-run-sdk.ts:396,415-426`, `rules/review-verdict.ts` (`reviewerCommand`), `board/src/server/entry/review.ts:408-470,619`, `workflows/dispatch-verbs.ts:183-197`, `fleet/src/shared/restart-command.ts:70-120`, `fleet/src/shared/continuation.ts:155-163`, `fleet/src/server/entry/{continue,restart,restart-stopped}-command.ts`, `board/src/server/{continue,restart}.ts`, `board/src/server/entry/ask.ts`, `workflows/merge.ts`, `rules/controller-gate.ts`, `rules/spawn-contract.ts:1-40`, `rules/board-run-end.ts:29`, `skills/plot-init/SKILL.md:41,560-616`, `plot-install-prompt.sh`, `.plot/charters/reviewer.json`, `.gitignore`. Ran: domain vitest `agent-run-command.test.ts`, `review-verdict.test.ts`, `workflows-dispatch-verbs.test.ts` (3 files, 73 pass); fleet vitest `restart-command.test.ts`, `continue-command.test.ts` (16 pass); `node --test test/reconcile/spawn-contract-gate.test.mjs` (2 pass); three live `claude -p --model haiku` probes (CLI 2.1.312) in a scratch project with a `.claude/agents/probe.md`, to learn whether a project agent definition loads under the reviewer's own flags (results under (b)).

## (a) Problem statement

- **False: "`continue`, `restart`, `merge` refuse every unattended caller."** Only `restart` does. `grep -i unattended` finds 0 hits in `fleet/src/server/entry/continue-command.ts`, `fleet/src/shared/continue-command.ts`, `board/src/server/continue.ts`, `board/src/server/entry/ask.ts` and `domain/src/workflows/merge.ts`. The one refusal is `restartWorker` at `workflows/dispatch-verbs.ts:194-197` (`'unattended'`), mapped through `fleet/src/shared/restart-command.ts:81` and `continuation.ts:162-163` (whose comment says *"`restart`: the caller runs unattended"*). `rules/controller-gate.ts:12` lists `ControllerAction = 'dispatch' | 'approve' | 'deliver' | 'release' | 'restart'`. It has no `continue` and no `merge`, and its merge rule is the head pin (`:241-253`), not unattendedness. The design table makes the same claim only for restart (*"Restart a dead desk — manual; `restart` refuses an unattended caller"*). The plan widens it to three controllers. Slice 3 would either lift a refusal that does not exist (no test can fail first) or add new refusals to `continue` and `merge`, which neither the design nor the issue asks for.
- **`restart` has three entrances that each read `PLOT_UNATTENDED` themselves.** `board/src/server/restart.ts:68` reads the BOARD process's env. `fleet/src/server/entry/restart-command.ts:89` and `restart-stopped-command.ts:103` read their own process env. All three reach the one domain rule `restartWorker`. The plan does not name the entrances.
- **"`agentRunCommand` … start `claude -p --agent <role>`" puts the change in the wrong place.** `agentRunCommand` runs whatever `deps.fragment` it is given (`agent-run-command.ts:67-69`). Its own doc says it "does not interpret `request.model` or `request.effort`" and "has no CLI flag vocabulary". The `claude -p …` string for the reviewer is built in the domain by `reviewerCommand` (`rules/review-verdict.ts`, about lines 156-185), and `review.ts:420-422` hands it to `deps.agentRun(command.command)`.
- **`AgentRunRequest.role` already exists (`ports/agent-run.ts:47`) and means something else.** It selects the hand-back protocol (`agent-run-sdk.ts:150-151,396`, with `boardHandBackKind` at `rules/board-run-end.ts:29`). It is also recorded in slice spend (`workflows/slice-spend.ts:174,191`). An unknown role such as `fixer` falls through to the `written` hand-back. "Take a role name" therefore collides with a field whose current values are `worker`, `idea`, `brief` and `reviewer`.

## (b) Approach

- **Defect (executed): the reviewer cannot pick up `.claude/agents/reviewer.md` while it keeps `--setting-sources user`.** `reviewerCommand` passes `--setting-sources user` on purpose, so "no hook or permission rule from the reviewed tree applies". Probes run in a scratch project:
  - `claude -p --setting-sources user --agent probe` printed `--agent 'probe' not found`.
  - `--setting-sources user,project --agent probe` loaded it (`PINEAPPLE42`), but that also loads the reviewed tree's project settings, which is the very thing `reviewerCommand` excludes.
  - `--setting-sources user --agents <file outside the tree> --agent probe2` loaded it (`MANGO77`).

  The review worktree is the PR's head (`review.ts:430`, `trees.add(tree, sha)`), so a definition read from cwd is one the PR under review can rewrite. The same holds for the fixer, which runs on the PR's own branch: a PR that edits `.claude/agents/fixer.md` weakens its own fixer's hooks. The runner must load each definition from the default branch's copy, for example through `--agents <path>` written from `origin/<default>`, not from the run's cwd. A test must hold this. The plan's Approach does not mention it.
- **Two model sources.** The charter names `model: opus, effort: high` (`.plot/charters/reviewer.json`), and `reviewerCommand` turns them into `--model` and `--effort`. The definition's frontmatter will name a model too. The plan must say which one wins, and a test must assert that the built command carries exactly one source. The same applies to `maxTurns`: `AgentRunRequest.maxTurns` (`ports/agent-run.ts:56`) and the frontmatter `maxTurns` are both bounds.
- **`isolation: worktree` against "commits on the PR's branch".** Frontmatter isolation creates a fresh worktree for a subagent. For a top-level `claude -p --agent` session, the port's `worktree` (cwd) already decides where the run works. If isolation applies at all, the fixer's commits land on a branch that is not the PR's. Neither the plan nor the design says which reading holds. This needs one characterisation probe before slice 2 is written.
- **Caller identity and inheritance.** `agentRunEnv` merges the inherited environment (`rules/agent-run-env.ts:45-60`). If fleetd carries its identity as an env var in its own environment, every desk worker fleetd starts inherits it, and the restart refusal is lifted for workers too. Any unattended process can also set the variable. If a gate reads the variable, the bump rule at `spawn-contract.ts:15-24` applies and `test/reconcile/spawn-contract-gate.test.mjs` fails until `SPAWN_CONTRACT` moves; I ran it and it passes today. For the board entrance, `restart.ts:68` reads the board's own env, so an HTTP caller cannot declare an identity through env at all. The identity there would come from the request, where any local client can forge it.
- **Layering.** The identity belongs in the domain readings beside `unattended` (`dispatch-verbs.ts:134-135`), for example `caller: 'fleetd' | 'other'`, so `restartWorker` decides. Entrances only read the identity, and nothing in an entrance branches on it. The plan says "the controllers read" it, which leaves room for three copies of the check.

## (c) Slices

- **Slice 1 (runner)** as cut changes `agentRunCommand`. It should change the command builder instead: generalise `reviewerCommand` into a domain `roleCommand(role, definitionPath, charter?)` and keep the adapter fragment-agnostic. The definition file must exist on main before slice 1 can start a real role. So either slice 2 precedes slice 1, or slice 1 ships only the reviewer, whose definition it adds itself.
- **Slice 3** should be re-cut as "restart lifts its unattended refusal for fleetd's caller", with one domain change and three entrances. `continue` and `merge` should leave the slice unless the plan first shows that they refuse today. If the plan intends to ADD an unattended refusal to them, that is a behaviour change for every existing unattended caller and needs its own slice and a statement in the design.
- **Missing:** a test or gate that keeps the repo's `.claude/agents/*.md` equal to the shipped template slice 4 installs (`plot-init` precedent: the shipped template is `skills/plot/templates/worker-prompt.sh`, installed by `plot-install-prompt.sh`, which never overwrites and reports `stale`/`present`).
- **Order:** 2 → 1 → 3 → 4. Slice 4 depends on the shipped template that slice 2 creates.

## (d) Open questions

1. **Caller identity form.** An env var alone is forgeable and inherited (see (b)). It is testable as a domain reading, but the forgery question has no unit-test answer. One evidence-backed option is a token fleetd writes under `.plot/state/` at start, readable only by the user, and passes to the role's env by value; the domain compares the two readings. The plan should also state that the identity is cleared from every worker-loop spawn's env, and assert it.
2. **Hook checks.** Bundles: `scripts/check-no-bundle-diff.sh` exists, and CLAUDE.md says a committed bundle is "refused at commit time and again in CI", so a definition hook adds nothing that is not already a gate; reuse it. "Fixes #N" can be grepped on `git commit -m` / `plot-open-pr.sh` arguments in a PreToolUse hook. "Never edit a gate" can be grepped on Edit/Write paths (`scripts/check-*.sh`, `.github/workflows/ci.yml`). Bash 3.2: `check-bash32-syntax.sh` is already in Local checks. "Never join lines" has no grep form, because `check-shell-lines.sh` counts lines and a join lowers the count. Keep it an instruction.
3. **Copy or template.** Use the `plot-install-prompt.sh` contract: a shipped template, written where absent, never overwritten, `stale` reported. Write it in TypeScript (as a bundle), not a new `.sh`, per the shell-line ratchet.

New questions the plan should carry:

4. Where is the definition read from: the run's cwd (PR-controlled) or the default branch? (See (b); this is the security property.)
5. Charter or frontmatter: which one names the reviewer's model, effort and turns?
6. Does `isolation: worktree` apply to a top-level `--agent` session, and if it does, how does the fixer commit to the PR's branch?
7. Does the SDK runner (`agent-run-sdk.ts:423`, `settingSources: ['user','project','local']`) start a role definition the same way, or is `--agent` command-runner only? "One runner" is false while two adapters implement the port.
8. A field name other than `role` for the definition, or a stated mapping from the existing `role` values to definitions.

## (e) Tests per slice

All of the following are checkable with no live fleet, host or browser, except the two characterisation probes, which need a live `claude` binary and stay out of CI.

- **Slice 1, domain unit, `packages/domain/test/review-verdict.test.ts` (extend) or a new `role-command.test.ts`.**
  - Fixture: `{ role: 'fixer', definitionPath: '/repo/.git/plot/agents/fixer.md' }`.
  - Assert: the built command contains `--agent 'fixer'` and `--agents '<path>'`, and still contains `--setting-sources user`. Assert that the reviewer command keeps `--tools Read,Grep,Glob`, `--permission-mode dontAsk` and `--strict-mcp-config`, and contains no `bypassPermissions`. Assert that a role name outside `[a-z-]+` refuses, mirroring the existing `COMMAND_WORD` injection tests at `review-verdict.test.ts:175-179`. Assert one model source.
  - Adapter tier, `agent-run-command.test.ts`: the existing `args` fixture at `:43-57` (`['-u','PLOT_REPO_ROOT','bash','-c','claude -p "$@"','_',prompt]`) must stay unchanged. That proves the adapter remains fragment-agnostic.
  - Board unit, `packages/board/test/unit/review.test.ts`: the `agentRun` dep receives a fragment naming the reviewer definition from outside the review worktree.
- **Slice 2, reconcile `node --test`, new `test/reconcile/role-agents.test.mjs`.**
  - Parse each `.claude/agents/*.md` frontmatter. Assert that name, model, `maxTurns` (> 0) and `memory: local` match the design table. Assert that a `hooks.PreToolUse` entry exists for fixer and main-repair. Assert that `.gitignore` contains `.claude/agent-memory-local/`, checked with `git check-ignore`.
  - Run each hook command with a PreToolUse JSON on stdin, the shape `controller-gate.test.mjs` already feeds. An Edit of `scripts/check-shell-lines.sh` exits non-zero. A `git commit -m "Fixes #12"` exits non-zero. A plain commit exits zero.
  - Characterisation probe, manual, recorded in the plan: `claude -p --agent fixer` with `--setting-sources user --agents <file>` loads the hooks (a denied Edit is reported).
- **Slice 3, domain unit, `packages/domain/test/workflows-dispatch-verbs.test.ts`.** It already has `restart({ unattended: true })` → `'unattended'` at `:104-105`. Add:
  - `{ unattended: true, caller: 'fleetd' }` → start.
  - `{ unattended: true, caller: '' }` → `'unattended'`.
  - `{ unattended: false, caller: 'fleetd' }` → start.
  - A test that `release` (`workflows/release.ts:239`) refuses `{ unattended: true, caller: 'fleetd' }`.

  Fleet unit tier: `packages/fleet/test/unit/restart-command.test.ts:138-148` already drives `restartBranch` with `unattended` injected. Add the caller reading there and in a restart-stopped test. Add one fleet unit test that the worker-loop spawn env does NOT carry the identity. If the identity is an env var a gate reads, `spawn-contract-gate.test.mjs` must fail first and pass after the `SPAWN_CONTRACT` bump.
- **Slice 4, reconcile `node --test`, modelled on `workerprompt.test.mjs`.** Run the installer in a `mkdtemp` git repo. Assert:
  - An absent definition is written byte-equal to the template.
  - An existing one is untouched, with exit 3 and `stale`/`present`.
  - A second run is a no-op.

  Also add a dog-food test that the repo's `.claude/agents/*.md` equal `skills/plot/templates/agents/*.md`.
- **Plan acceptance criteria:** the plan states none per slice beyond the `builds:` comments. "the reviewer starts through it" and "fleetd declares its caller identity" are not assertions. Each slice needs one named failing-first test, as listed above.

## Amendments

1. Correct the Motivation: only `restart` refuses an unattended caller today (`dispatch-verbs.ts:194`). Either drop `continue` and `merge` from slice 3, or state that the plan adds a new refusal to them, and why.
2. Move the `--agent` construction from `agentRunCommand` into a domain command builder that generalises `reviewerCommand`. Keep the adapter's args test unchanged.
3. Load each role definition from the default branch's copy through `--agents <path>` outside the run's tree, and keep `--setting-sources user` for the reviewer. Add a test that the built command never makes the definition depend on the PR's tree (probe results in (b)).
4. Name a field other than `AgentRunRequest.role`, or map the existing `role` values to definitions explicitly. Say whether the SDK runner starts roles too.
5. Put the caller identity in `restartWorker`'s readings, and name the three entrances (`board/server/restart.ts:68`, `fleet/entry/restart-command.ts:89`, `restart-stopped-command.ts:103`). Choose a form that worker-loop spawns do not inherit, and assert that they do not. Apply the `SPAWN_CONTRACT` bump rule if a gate reads it.
6. State which source wins for model, effort and turns between the charter and the frontmatter. State whether `isolation: worktree` applies to a top-level `--agent` run, settled by a recorded probe.
7. Reorder the slices to 2 → 1 → 3 → 4. Give each slice the failing-first test listed in (e). Add the template-equality test to slice 4.
