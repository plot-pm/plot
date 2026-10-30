## Implementation brief — fleet-roles-are-declared-agents (wave 3: Role definitions)

- **Plan (canonical):** docs/plans/2026-10-29-fleet-roles-are-declared-agents.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2908 merged
- **Branch:** `feature/role-agent-definitions` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`; one full review per PR)

This branch waits on `feature/role-agents-are-probed` (wave 1, merged — PR #2919). It is the first wave to write product code; `feature/role-agents-start-detached` (wave 4) and `feature/plot-init-provides-roles` (wave 5) both read the files this branch creates, and neither has started.

### What to build

The first `.claude/agents/*.md` files and per-role settings files this repository has ever had — `ls .claude/agents` on main returns nothing today, and no `.claude/settings.json` exists either. Four role definitions (reviewer, fixer, unblocker, main-repair) and four matching settings files, each holding the gates as `PreToolUse` hooks. fleetd will read both off `origin/<default>` and pass them as `--agents <file>` / `--settings <file>`, written outside the run's own tree — never from the reviewed or fixed worktree. This slice does not wire fleetd's start command (that's wave 4); it supplies the files and whatever domain rules decide their content.

The failure this prevents: a definition or gate read from the run's own cwd lets a PR rewrite the rules its own reviewer or fixer runs under. The probe (wave 1) confirmed the route that avoids this — `--setting-sources user` plus `--agents <file outside the tree>` plus a `--settings <file>` holding the `PreToolUse` hook — and confirmed it survives a hostile tree carrying its own `.claude/settings.json` and `.claude/agents/<name>.md` with the same name.

### Decisions the plan settles — do not re-derive them

- **The gates live in the settings file, never in the definition's frontmatter.** Probe result 2 (plan `### Probe result`): a `PreToolUse` hook in frontmatter did not fire under `--agent`; the same hook in a `--settings` file blocked the call. Do not try the frontmatter route "to see if it works now" — it was measured on 2.1.312 and is closed.
- **`maxTurns` in the `--agents` definition does NOT bound a `--agent`-selected top-level run.** Probe result 3: REFUTED, two runs, `num_turns` exceeded the declared cap both times. `--help` and the SDK docs describe the per-agent `maxTurns` as bounding a *subagent a running session spawns*, not the session's own top-level identity — which is what `--agent <name>` makes it. **This slice still records `maxTurns` in each definition file** (the plan's own shape, "holding the prompt, the model and `maxTurns`"), but do not treat it as an enforced bound today, and do not invent a workaround (a wrapper session, a session-level `--max-turns`) — that choice is explicitly left open for wave 4 (`feature/role-agents-start-detached`), which builds the actual start command. Writing the field and relying on it are two different claims; this slice makes only the first.
- **`memory: local` writes inside the run's own cwd, under `.claude/agent-memory-local/<agent-name>/` — not outside the tree.** Probe result 4: REFUTED. For a fixer or main-repair role whose tree is the PR's own checkout, declaring `memory: local` would write into the reviewed/fixed tree itself, which is the failure D5 exists to avoid. **Do not declare `memory: local` on any of the four definitions.** Use `memory: user` (`~/.claude/agent-memory/<name>/`, outside every run's tree) where a role needs cross-run memory, or omit `memory` entirely if none do. This is an open call the plan hands to this slice — make it and say which you chose and why, per role.
- **The reviewer definition holds no write tools.** `review.ts` keeps the only `plot/review` status write; the reviewer role itself must not be granted a tool that could write it. Contrast with the existing `reviewerCommand` (`packages/domain/src/rules/review-verdict.ts:157`), which denies tools via `--disallowedTools` (`REVIEWER_TOOLS`/`REVIEWER_DENY` constants, same file, lines 124–131) on a *command-line* fragment — that mechanism is for the existing reviewer runner and is not what this slice touches or duplicates. This slice's denial is a `PreToolUse` hook in the settings file, the shape D5 specifies, not a second `--disallowedTools` list layered on top. If a role also needs a `--disallowedTools`-shaped restriction, that is wave 4's command-builder concern (the "domain command builder beside `reviewerCommand`"), not this slice's settings-file content.
- **Every non-reviewer role (fixer, unblocker, main-repair) denies, via hook:** `plot-host.sh commit-status`, `plot-review.mjs`, `gh pr merge`, `plot-ask.mjs merge`, a push to the default branch, and an edit to `.claude/**`, `scripts/check-*.sh`, `skills/plot/scripts/*-gate.sh`, and `.github/workflows/**`. A commit message containing "Fixes #N" is also denied. The probe's confirmed hook shape (result 2) reads `tool_input.command` from the hook's stdin JSON — never an env var (`$CLAUDE_TOOL_INPUT` does not exist) — and returns `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` on a match.
- **The hooks call arms of the existing `board/plot-gate.mjs` bundle** (`packages/board/src/server/entry/gate.ts`), decided by new domain rules living beside `packages/domain/src/rules/controller-gate.ts` — not a new `.sh` file under `skills/`. `plot-gate.mjs` already answers "every Plot gate for a Bash call" from one process (see its own file header, lines ~31–57): a call no gate wants never loads an adapter, and one gate's failure never decides another's. Add the role-denial checks as new gates in that same registry shape (`wants(command)` / `ask(command)`), not as a bespoke script the settings file shells to directly.
- **"Never commit a built bundle" stays with the existing gates** (`plot-bundle-commit-gate.sh` at commit time, `scripts/check-no-bundle-diff.sh` in CI) — do not duplicate that check into a role's settings file. **"Never join lines" and "bash 3.2" stay prose instructions** in the definition's prompt; `check-bash32-syntax.sh` already runs as a local check and is not re-implemented as a hook either.
- **This slice owns `unblocker.md`'s existence, not its prompt content.** The plan's Notes: "This plan owns all four definition files, including `unblocker.md`; #2901 owns the per-question prompt fleetd passes to the unblocker." Write a correct, generic unblocker definition (model, gates, tools) — the per-question prompt text is a different plan's scope and arrives as a runtime argument later, not as frontmatter here.
- **Role-to-tree table (plan `## Design`), for sizing each definition's `model` and tool list:**

  | Role | Model | Tree | Writes |
  |---|---|---|---|
  | reviewer | opus | a detached worktree at the PR head, created by fleetd | nothing; `review.ts` writes the status |
  | fixer | opus | a worktree on the PR's branch, created by fleetd | commits on the PR's branch |
  | unblocker | sonnet | read-only | an answer that fleetd passes to `continue` |
  | main-repair | opus | a worktree off the default branch, created by fleetd | a fix PR, or nothing |

  `isolation` in frontmatter is not relied on for any of these — the probe confirmed it is ignored under `--agent` (result/measurement bullet under D5). fleetd creates every worktree itself (wave 4's concern); do not declare `isolation: worktree` expecting it to do anything.
- **The plan's one Open Question is not this slice's to answer**, but this slice's definitions are what the answer will configure: "Which source names the reviewer's model and effort when both the charter (`.plot/charters/reviewer.json`, currently `{"model":"opus", ...}` — read it before writing `reviewer.md`) and `reviewer.md` name one?" Write `reviewer.md` with its own `model: opus` per the table above; do not delete or rewrite `.plot/charters/reviewer.json` to resolve the conflict — leave the reconciliation to wave 4, and note in your PR body that the two sources currently agree (both `opus`) so the conflict is latent, not yet live.
- Rules carried over: absent is not false — a missing hook output is not proof the hook blocked; read the exit code and the tool-result text, not the emptiness.

### Done when

The plan's slice line is the specification: "the four definitions and per-role settings files; non-reviewer roles deny status writes, review runs, merges, pushes to main, and edits to `.claude/**` and the gates; `memory: local` outside the PR tree" (note: per the REFUTED probe result above, the last clause is satisfied by *not* declaring `memory: local`, not by proving it writes outside the tree — say this explicitly in the PR body so a reviewer does not mark it incomplete for missing a `memory: local` field).

Assertions a naive implementation would pass without:

- A test (or a recorded manual run, if the domain gate functions have no existing harness for spawning `claude -p`) proving each of the four settings files' hooks actually deny the named forbidden calls and allow a permitted control in the same invocation — mirroring the probe's own "forbidden call plus permitted control in one session" shape, which exists specifically to catch a hook that blocks everything or a hook that never fires.
- A test that no definition declares `memory: local`.
- A test that the reviewer definition's tool list grants no write-capable tool.
- `scripts/check-plan-headings.sh` passes if this slice touches the plan file at all (it shouldn't need to, beyond what wave 1 already wrote).
- This repo's existing gate tests (`packages/domain/test/controller-gate.test.ts` and siblings) still pass unchanged — new gates are additive registrations, not edits to the controller-gate refusal shapes wave 2 is building concurrently (see Scope guard).

Plus: the repo's gates — build artifacts, changeset, platform constraints. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice is specified to add no new `.sh` file under `skills/` (the plan: "No new `.sh` file is added under `skills/`") — if you find yourself writing one to glue a hook to `plot-gate.mjs`, that is the sign to push the logic into a domain rule and a thin existing-bundle arm instead, not a new script.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under the "Role definitions" heading. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `.claude/agents/reviewer.md`, `.claude/agents/fixer.md`, `.claude/agents/unblocker.md`, `.claude/agents/main-repair.md`, their four settings files (naming convention is this slice's to pick — record it in the PR body since wave 4 and wave 5 both read it), and any new domain rule file(s) beside `packages/domain/src/rules/controller-gate.ts` that decide the hook denials. It does not own `packages/domain/src/workflows/{merge,dispatch-verbs,release}.ts` or their entrances (wave 2, `feature/unattended-callers-are-refused` — not yet started, no branch pushed) and does not own the command builder beside `reviewerCommand` or the liveness reading (wave 4, `feature/role-agents-start-detached` — not yet started).

No other branch of this plan has a ref pushed yet except the merged `feature/role-agents-are-probed`. If a sibling branch appears while this one is in flight, re-check `/plot-pulse` for what it touches before assuming no overlap.

If you find something the plan did not anticipate — in particular anything that changes the REFUTED `maxTurns`/`memory: local` findings, or surfaces a fifth file this repo needs — report it rather than improvising outside scope.
