# A role session may use its declared tools

> A fleetd role session starts with its definition's `tools` list as `--allowedTools`, so a fixer or main-repair session can write, edit and run Bash under the default permission mode, and the role's `role-deny` hook stays the gate.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** bug-fixes-2-35-0
- **Issue:** #3504
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3505 merged
- **Started:** 2026-11-17, Jan Wloka, `bug/a-role-session-may-use-its-declared-tools`
- **Delivered:** 2026-11-17

## Changelog

- A fleetd fixer or main-repair session may use the tools its role definition declares, so it no longer stops at a permission prompt on every Write, Edit and Bash call.

## Motivation

`roleCommand` (`packages/domain/src/rules/role-command.ts:62-83`) builds the fragment `claude -p --setting-sources user --agent <role> --agents "$(cat -- <agentsFile>)" --settings <settingsFile> [--max-turns <n>]` and passes no permission flag. With `--setting-sources user`, the operator's user settings decide the permission mode. `~/.claude/settings.json` on the operator's machine declares no `defaultMode` and no allow rule for Write, Edit or Bash, so each such call needs an approval that `-p` cannot give, and the CLI refuses it with "Claude requested permissions to write … but you haven't granted it yet".

Evidence from issue #3504:

- PR #3502: both fixer attempts on head `291f56c35` were refused every Write and Edit to `packages/domain/src/rules/ci-suite.ts` and a `git diff` (`.plot/state/fixer/3502.log` in the main checkout). The two attempts spent the head's fixer budget, and a person fixed the PR by hand.
- A `permissionMode` key in the `--agents` JSON has no effect on a session started with `--agent`. Measured 2026-11-17: no key, `bypassPermissions` and `acceptEdits` each left the Write refused. `roleAgentsJson` already accepts the key (`role-command.ts:89-91`), so carrying it is not a fix.
- `.claude/agents/fixer.md` and `.claude/agents/main-repair.md` declare `Read`, `Grep`, `Glob`, `Write`, `Edit` and `Bash`. `.claude/agents/reviewer.md` and `.claude/agents/unblocker.md` declare only `Read`, `Grep` and `Glob`, so the defect does not affect them.

The role settings file `.plot/state/fixer/3502/settings.json` holds the `role-deny` PreToolUse hook on `Bash` and on `Write|Edit|NotebookEdit`. That hook is the gate for protected paths, merges and pushes, and it runs before every allowed call.

To a user, the defect shows as a fixer or main-repair attempt that ends with no commit, a spent fixer budget, and a PR or a red default branch that waits for a person.

## Design

### Approach

The fix is a domain rule change plus one fleet adapter field. No controller, port or shell script changes.

1. **Domain, `packages/domain/src/rules/role-command.ts`.** Add an arrow export `roleTools(text: string): readonly string[]` that reads the `tools` list from a role definition's frontmatter with the same parser `roleAgentsJson` uses (`role-command.ts:109-130`), extracted into one internal helper so the two never disagree. It answers `[]` for a definition with no frontmatter, no `tools` key or an empty list. It takes the text as a value and reads no file, as the Layering Rule requires.
2. **Domain, `roleCommand`.** Add a third parameter `tools: readonly string[]`. Where the list is not empty, the fragment carries `--allowedTools '<comma-joined list>'`, single-quoted with the existing `singleQuote` (`role-command.ts:36`), placed before `--settings`. `--allowedTools` takes a variadic value, so it must never be the fragment's last flag: the caller appends a second `--settings` (`auto-fixer.ts:476`, `registryd-main.ts:1522`) or the runner appends the prompt as `"$@"`, and a trailing variadic flag would read the prompt as a tool name. Where the list is empty, the fragment carries no `--allowedTools`. The session keeps the default permission mode; no `--permission-mode` and no `--dangerously-skip-permissions` is added.
3. **Fleet adapter, `packages/fleet/src/shared/role-files.ts`.** `roleFilesAt` already reads the definition text (`role-files.ts:79-98`) and answers `maxTurns` from it. It also answers `tools: roleTools(definition.value)`.
4. **Callers.** The three `roleCommand(` callers pass `files.tools`: `packages/fleet/src/shared/auto-fixer.ts:468` (fixer), `packages/fleet/src/shared/repair-role.ts:116` (main-repair) and `packages/fleet/src/server/entry/registryd-main.ts:1517` (unblocker). The reviewer start in `packages/board/src/server/entry/review.ts:407` runs on the SDK runner, which sets `permissionMode: 'bypassPermissions'` (`agent-run-sdk.ts:474`) and does not call `roleCommand`, so it does not change. The test callers `role-command-cli.test.ts:49` and `agent-run-command.test.ts:248` pass the role's list or `[]`.

The tools travel as a parameter rather than as a `RoleAgentRef` field: `RoleAgentRef` is the run identity carried on `AgentRunRequest.roleAgent` (`ports/agent-run.ts:55`), and the SDK runner reads the tools from the agents JSON itself (`agent-run-sdk.ts:319-339`).

No shell/domain duplicate is declared, and no corpus row is needed. `maxTurnsOfRole` (`role-files.ts:48`) stays where it is; moving it is outside this fix.

### Open Questions

- [x] None.

## Done when

| Claim | Check | Slice |
|---|---|---|
| A role whose definition declares tools starts with them as one `--allowedTools` argument before `--settings` | `packages/domain/test/role-command.test.ts` › *"passes the declared tools as one --allowedTools argument before --settings"* | Tools |
| A role whose definition declares no tools starts with no `--allowedTools` | `packages/domain/test/role-command.test.ts` › *"passes no --allowedTools for a role that declares no tools"* | Tools |
| `roleTools` reads the `tools` list the `--agents` JSON carries, and `[]` where the key is absent | `packages/domain/test/role-command.test.ts` › *"roleTools reads the same list roleAgentsJson carries"* | Tools |
| The prompt still reaches the CLI as the last argument with `--allowedTools` present | `packages/domain/test/role-command-cli.test.ts` runs the fixer fragment with its six tools against the fake `claude` and the prompt arrives intact | Tools |
| The fixer start passes the fixer's declared tools | `packages/fleet/test/unit/auto-fixer.test.ts` › *"starts with the definition's tools as --allowedTools"* | Tools |
| The main-repair start passes its declared tools | `packages/fleet/test/unit/repair-role.test.ts` › *"starts with the definition's tools as --allowedTools"* | Tools |
| The domain stays pure | the purity gate in `ci.yml` reports 0 violations | Tools |

## Slices

### Tools

- `bug/a-role-session-may-use-its-declared-tools` — `packages/domain/src/rules/role-command.ts` (`roleTools`, `roleCommand`'s `tools` parameter), `packages/fleet/src/shared/role-files.ts`, the three callers in `auto-fixer.ts`, `repair-role.ts` and `registryd-main.ts`, tests in `packages/domain/test/role-command.test.ts`, `role-command-cli.test.ts`, `agent-run-command.test.ts`, `packages/fleet/test/unit/auto-fixer.test.ts` and `repair-role.test.ts`, and a changeset for `plot` (patch; no skill directory changes, so no `bumps:` block) <!-- builds: roleTools, the declared tools of a role definition --> → #3506

## Notes

- Deliverable search: `plot-deliverable-search.sh "roleTools"` names no existing export of that name; every listed hit is a common word (`role`, `Tools`). `grep -rn allowedTools packages/*/src` finds no `--allowedTools` anywhere; the estate passes only `--disallowedTools` (`rules/review-verdict.ts:239`, `rules/agent-run-env.ts:20`). The slice is not a duplicate.
- Related plans: `docs/plans/2026-10-29-fleet-roles-are-declared-agents.md` (introduced `roleCommand`) and `docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md` (Released; introduced the fixer and main-repair starts and the `role-deny` hook).
- PR #3502 is the measured failure.
