# Panel moderation: fleet-roles-are-declared-agents

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: three jurors ran `claude -p --agent` probes (Claude Code 2.1.312, haiku); two ran domain probes calling `merge`, `release` and `restartWorker` with an unattended caller; 51–73 domain and fleet unit tests passed as baselines.

## Agreed by all four

1. **The caller-identity premise is false for three of four controllers.** Executed: `restartWorker` refuses `unattended` (`dispatch-verbs.ts:194`); `merge` takes no caller input and decides a pinned merge; `continue` has no unattended refusal (`continuation.ts:162` gives it to restart only); `release` with `unattended: true` decides and writes `Released` (`release.ts:21,239`). The design (line 144) carries the same error. So the slice must ADD refusals before any identity can lift them, and "release refuses every unattended caller" is new work, not a kept rule.
2. **A definition read from the PR's own tree lets a PR rewrite its reviewer or fixer.** `reviewerCommand` runs with `--setting-sources user` (`review-verdict.ts:179`) on purpose. Probed: under it `--agent <name>` answers "not found"; adding `project` loads it but also loads the reviewed tree's hooks and settings; `--agents <file outside the tree>` loads under `user`. Definitions must load from the default branch's copy (or the plugin), and a test must hold that.
3. **`--agent` belongs in a domain command builder, not in `agentRunCommand`.** `agentRunCommand` runs any configured command; appending a claude flag breaks non-claude commands and the existing worker, idea and brief roles. `AgentRunRequest.role` already exists (`ports/agent-run.ts:47`) and selects the hand-back protocol, so the role-agent name needs its own field. The SDK adapter (`agent-run-sdk.ts:423`) is not covered, so "one runner" is not true yet.
4. **Sibling plans duplicate or misname this plan's pieces.** #2901 also builds `unblocker.md`; #2903 says the fixer comes from #2902; #2902 says the caller identity comes from #2900. This plan owns all four definitions and the runner field.

## Findings one juror executed that change the design

- **Under `--agent`, frontmatter `hooks` did not fire and `isolation: worktree` was ignored** (seams, one run each). The same hook in `.claude/settings.json` did block. The design's "hooks in each definition are the gates" and "fixer: isolation worktree" are unproven. A probe slice must come first, before four files are written against an assumption.
- **Any local process can write `plot/review=success`** through `plot-host.sh commit-status` with the App key, and the controller gate allows every call from a linked worktree (`gate.ts:688`), including an unpinned `gh pr merge` (safety). Every non-reviewer role needs a deny on status writes, review runs, merges, pushes to main and edits to `.claude/**` and the gates.
- **An env-var identity spreads by inheritance** (`agentRunEnv`, `bounded-run-process.ts:113`). Two answers: a typed argument where fleetd calls in-process (seams; `restart` from #2906 is in-process), or a single-use token file (safety). Either needs a `SPAWN_CONTRACT` bump if a gate reads it (layering, testability).
- `memory: local` lands inside the PR tree, where a commit can pick it up (safety).
- `isolation: worktree` cannot coexist with a dead desk's worktree holding the PR branch (safety, seams, testability).

## Disagreements

- **Identity carrier.** Layering prefers an env var after `PLOT_MAIN_CHECKOUT_WRITER` plus a gate arm refusing a hand-set value; safety and seams refuse an env var. Moderator: a typed argument for in-process calls, and no carrier at all for a role, because no role is granted `merge` or `restart` (safety's scoping).
- **Slice order.** Testability: probe → definitions → identity → init. Safety: refusals and hooks before any identity. Compatible: probe, refusals, definitions loaded from main, runner field, init.

## Shared blind spot

All four judged mechanism and trust. None asked whether four separate role definitions are needed at all once frontmatter hooks are shown not to fire: if the gates must live in settings anyway, a definition carries only a prompt and a model, which a charter (`.plot/charters/reviewer.json`) already does.

## For the person

1. Frontmatter hooks and `isolation` were not honoured under `--agent` in the probe. Keep role agents as `.claude/agents/*.md` (gates move to a settings file passed per role), or carry each role as a charter like the reviewer's?
2. Release: add a new unattended refusal (the design's intent), given that today it proceeds unattended?
