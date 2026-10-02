# An agent starts with the context it reads

> Every Plot session, fleet worker and subagent starts with about 20k tokens of `CLAUDE.md` it does not read and plugin context it does not use, and pays for them on every request. This plan removes that context and measures the change.

## Status

- **State:** Draft
- **Type:** infra
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The Helper Scripts table moves from `CLAUDE.md` to `skills/plot/scripts/README.md`. `CLAUDE.md` keeps a pointer, so every Plot session and fleet agent starts with about 20k fewer tokens.
- Fleet workers start without plugins they do not use, through the `Agent settings` file.
- The master agent starts a briefed subagent instead of a fork when its own context is large, and runs mechanical subtasks on Sonnet.
- The reviewer charter's model is chosen by a side-by-side panel.

<!-- Board impact: none. The board reads `## Plot Config`, which stays in CLAUDE.md. -->

## Motivation

Measured 2026-10-02 with `python3 ~/claude-usage-report.py` over local transcripts, 2026-10-01 00:00 to 2026-10-02 14:30 Europe/Zurich. "Weighted" is input-equivalent tokens: input ×1, output ×5, cache write 5m ×1.25 and 1h ×2, cache read ×0.1.

| fact | value |
|---|---|
| total weighted spend, all projects | 514M |
| Plot's share (repo, worktrees, scratchpads) | 84% |
| the master session, with its subagents | 293M (57%) |
| fleet workers (`claude -p`), all projects | 29% |
| first-request context of a Plot session / worker / subagent | 125k / 123k / 94–103k |
| `CLAUDE.md` | 137,491 chars; `## Helper Scripts` is 82,596 of them (60%) |
| worker context growth | linear, about 100k → 350–420k over 170–270 requests, no compaction |
| `fork` subagents in the master session | 34, starting at a median 336k, 84M weighted (16% of all spend) |
| `general-purpose` subagents in the master session | 65, starting at a median 100k, 75M weighted, all on Opus |
| juror and panel agents | about 2% of spend |

Cost scales with context size times request count. A worker's first request already carries ~123k, and every later request carries it again. The Helper Scripts table alone is about 20k tokens. Fleet agents read it on every request, but no code reads it: `git grep "Helper Scripts"` finds it only in briefs, which tell an agent to add a row there.

The changes remove context the model does not use. They do not reduce reasoning effort or model tier where a judgement is made.

## Design

### Approach

**1. The Helper Scripts table moves to `skills/plot/scripts/README.md`** (slice 1).
- The file is new and holds the table unchanged, under the same heading. `CLAUDE.md` keeps two lines in its place: the file's path, and the rule "a new script gets a row there".
- `## Plot Config` stays in `CLAUDE.md`, because `plot-config.sh` and `agent-log.ts` read keys from it.
- The briefs on `main` that say "add a row to the Helper Scripts table in `CLAUDE.md`" are history and stay as written. The brief-writing step (`/plot-implement`'s hand-off brief) names the new file from now on, if its text names the table at all.
- Expected effect: about 20k fewer tokens at the start of every Plot session, worker and subagent.

**2. Fleet workers start without unused plugins** (slice 2).
- `.plot/agent-settings.json` reaches every worker through `--settings` and today disables only `episodic-memory`.
- **The list comes from the transcripts, not from a guess.** The slice reads which skills and plugin tools fleet worker transcripts invoked since 2026-09-28, and disables each enabled plugin that no worker used. Candidates named on 2026-10-02: `learning-output-style`, `figma`, `frontend-design`, `document-skills`, `slack`, `elements-of-style`, `code-simplifier`, `pr-review-toolkit`.
- `oh-my-claudecode` is a separate decision recorded in the slice. At every worker start it adds 13.6k chars of `hook_success` and 10.6k chars of `hook_additional_context`, and it adds a hint after every tool call.
- **`agentSettingsRefusal` bounds the file.** It refuses `plot@…: false`, `disableAllHooks` and any `env` key, so the change stays inside those limits.
- **The claude.ai MCP connectors** add 10–25k chars per worker, and a settings file cannot remove them. The slice measures whether `--strict-mcp-config` in `.plot/worker-prompt.sh` removes them: confirm the invocation with `PLOT_PRINT_INVOCATION=1`, then read a worker's first-request attachments (`deferred_tools_delta`). It adopts the flag only if a worker still has the tools its slices use.

**3. The master agent briefs rather than forks above ~200k context** (slice 3).
- A fork starts with the parent's whole context, a median 336k here. A briefed `general-purpose` agent starts at about 100k.
- `CLAUDE.md` › *The Master Agent Uses The Controllers* gains the rule: above about 200k context, start a `general-purpose` agent with a written brief instead of a fork. Mechanical subtasks (search, git, test runs, verification) run with `model: sonnet`, which applies `## Model Tiers` to Agent calls.
- **This is a rule, not a gate**, and the plan says so. The spawn decision happens inside a model turn, and no hook can read the parent's context size. The user-level `~/.claude/CLAUDE.md` got the same rule on 2026-10-02.

**4. The reviewer charter's model is measured** (slice 4).
- `.plot/charters/reviewer.json` runs Opus at `effort: high`. Jurors cost about 2% of spend.
- One panel runs the same plan twice, once with the charter on Opus and once on Sonnet. Sonnet stays only if every juror's position and named findings match. Otherwise the charter stays and the slice records the comparison.

### Verification

- **Before each slice merges,** record the baseline it changes, from the table above.
- **After all slices merge,** run `python3 ~/claude-usage-report.py --since <first full day after the last merge>`. Compare the first-request context of a session, a worker and a subagent, the fork start size, and the Plot and worker shares, against the Motivation table.

## Done when

- Slice 1: `CLAUDE.md` is at most 56k chars. `skills/plot/scripts/README.md` holds every row the table held. No gate, test or skill reads the table from `CLAUDE.md`. A new worker's median first-request context falls by at least 15k tokens against 123k.
- Slice 2: the settings file disables every plugin that no worker transcript since 2026-09-28 used. The oh-my-claudecode and `--strict-mcp-config` decisions are recorded with their measurements. A new worker's median first-request context is measured and recorded.
- Slice 3: `CLAUDE.md`'s master-agent section states the spawn rule with its 200k threshold and the Sonnet tier for mechanical subtasks.
- Slice 4: the side-by-side panel's two moderations are in `.plot/panels/`, and the charter's model follows the rule above.
- After all four: the verification report above is in Notes.

### Open Questions

- [ ] Does any skill or worker prompt read a script's purpose from `CLAUDE.md` rather than from the script's header? If one does, it reads the new file after slice 1.
- [ ] Is oh-my-claudecode's per-tool hint used by any fleet worker? Slice 2 answers this from transcripts before deciding.

## Slices

### The helper table leaves CLAUDE.md

- `infra/the-helper-table-leaves-claude-md` — moves `## Helper Scripts` to `skills/plot/scripts/README.md` with a two-line pointer; measures a new worker's first-request context before and after <!-- builds: skills/plot/scripts/README.md, the helper-script reference -->

### A worker starts without unused plugins

- `infra/a-worker-starts-without-unused-plugins` — disables, in `.plot/agent-settings.json`, the plugins no worker transcript used; records the oh-my-claudecode and `--strict-mcp-config` decisions with measurements

### The master agent briefs rather than forks

- `docs/the-master-agent-briefs-rather-than-forks` — the spawn rule and the Sonnet tier for mechanical subtasks in CLAUDE.md's master-agent section

### The reviewer charter is measured

- `infra/the-reviewer-charter-is-measured` — one panel on Opus and on Sonnet, side by side; the charter keeps Sonnet only if the verdicts match

## Notes

- 2026-10-02: drafted from a hand-off brief written in the quaweb-website session, which held the measurements above. The operator chose all four changes and sprint 2.22.3.
