## Implementation brief — a-role-session-may-use-its-declared-tools

- **Plan (canonical):** `docs/plans/2026-11-17-a-role-session-may-use-its-declared-tools.md` on `main`
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3505 merged
- **Branch:** `bug/a-role-session-may-use-its-declared-tools` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

A fleetd fixer or main-repair session cannot Write, Edit or run Bash. `roleCommand` (`packages/domain/src/rules/role-command.ts:62`) builds `claude -p --setting-sources user --agent <role> --agents … --settings …` and passes no permission flag, so the operator's user settings decide, and they allow none of those tools. `-p` cannot ask, so the CLI refuses each call. Measured 2026-11-17 on PR #3502: both fixer attempts on head `291f56c35` were refused every Write and Edit to `packages/domain/src/rules/ci-suite.ts` and a `git diff`; the head's fixer budget was spent and a person fixed it by hand (`.plot/state/fixer/3502.log`, issue #3504).

The fix passes the role definition's own `tools` list as `--allowedTools`:

1. `roleTools(text: string): readonly string[]` — new arrow export in `role-command.ts`. It reads the `tools` list through the SAME frontmatter parser `roleAgentsJson` uses (`:109-130`), extracted into one internal helper so the two cannot disagree. It answers `[]` for no frontmatter, no `tools` key or an empty list. It takes text and reads no file.
2. `roleCommand(role, maxTurns, tools)` — third parameter. A non-empty list adds `--allowedTools '<comma-joined>'` (use the existing `singleQuote`, `:36`) **before `--settings`**. An empty list adds nothing.
3. `roleFilesAt` (`packages/fleet/src/shared/role-files.ts:79-98`) answers `tools: roleTools(definition.value)` beside `maxTurns`.
4. The three callers pass `files.tools`: `auto-fixer.ts:468`, `repair-role.ts:116`, `registryd-main.ts:1517`. Test callers `role-command-cli.test.ts:49` and `agent-run-command.test.ts:248` pass the role's list or `[]`.

Write the failing tests first, then the change.

### Settled decisions — do not re-derive them

**`permissionMode` in the `--agents` JSON is not the fix.** `roleAgentsJson` already accepts the key (`:89-91`), but measured 2026-11-17: with no key, `bypassPermissions` and `acceptEdits`, the Write stayed refused. A session started with `--agent` ignores it. Do not try it again.

**No `--permission-mode` and no `--dangerously-skip-permissions`.** The session keeps the default mode and `--allowedTools` licenses exactly what the definition declares. The role's `role-deny` PreToolUse hook (on `Bash` and `Write|Edit|NotebookEdit`) runs before every allowed call and stays the gate for protected paths, merges and pushes. Widening the mode would route around that gate's premise.

**`--allowedTools` is variadic, so it must never be the fragment's last flag.** Callers append a second `--settings` (`auto-fixer.ts:476`, `registryd-main.ts:1522`) or the runner appends the prompt as `"$@"`; a trailing variadic flag reads the prompt as a tool name. Putting it before `--settings` is what the CLI test must prove: the prompt arrives intact as the last argument.

**Tools travel as a parameter, not a `RoleAgentRef` field.** `RoleAgentRef` is the run identity on `AgentRunRequest.roleAgent` (`ports/agent-run.ts:55`), and the SDK runner reads tools from the agents JSON itself (`agent-run-sdk.ts:319-339`).

**The reviewer does not change.** `review.ts:407` runs on the SDK runner, which sets `permissionMode: 'bypassPermissions'` (`agent-run-sdk.ts:474`) and never calls `roleCommand`. `reviewer.md` and `unblocker.md` declare only `Read`, `Grep`, `Glob`, so the unblocker's list is harmless to pass.

**No shell/domain duplicate, no corpus row.** `maxTurnsOfRole` (`role-files.ts:48`) stays where it is; moving it is out of scope. `grep -rn allowedTools packages/*/src` finds nothing today — the estate passes only `--disallowedTools` — so there is no prior convention to match.

**Carried-over rules.** Absent is not false: a definition with no `tools` key answers `[]` and gets no flag, it is not an error. In `packages/domain/**`, new functions are arrows and TSDoc states facts (what it does, parameters, returns, failure), with no decision history; the history belongs in the commit message.

### Done when

The plan's `## Done when` table is the specification. Seven checks:

- `role-command.test.ts` › *"passes the declared tools as one --allowedTools argument before --settings"* — catches a flag placed last or one argument per tool.
- `role-command.test.ts` › *"passes no --allowedTools for a role that declares no tools"* — catches an empty `--allowedTools ''`, which the CLI would read as granting nothing or swallowing the next flag.
- `role-command.test.ts` › *"roleTools reads the same list roleAgentsJson carries"* — assert equality with `roleAgentsJson`'s `tools`, and `[]` where the key is absent. This catches the two parsers drifting.
- `role-command-cli.test.ts` runs the fixer fragment with its six tools against the fake `claude`; the prompt must arrive intact. This is the one a naive implementation passes without, because the string tests above cannot see argv consumption.
- `auto-fixer.test.ts` › *"starts with the definition's tools as --allowedTools"* and `repair-role.test.ts` › the same name — each catches a caller that forgot `files.tools`.
- The purity gate in `ci.yml` reports 0 violations.

Plus: add a changeset for `plot` (patch; no skill directory changes, so no `bumps:` block), description first, at least 20 characters. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and not `test:e2e`. No `.sh` file is touched, so `check-shell-lines.sh` is not in play; if one changes, pay for its growth in the same change.

### Bookkeeping

When the PR opens, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/role-command.ts`, `packages/fleet/src/shared/role-files.ts`, the three callers, the five test files the plan lists, and one changeset. Verified at dispatch: no other open branch names `role-command.ts`; the only role-adjacent remote ref is `bug/main-repair-ad63459de05f`, a fleetd repair branch for the default branch, not a plan slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
