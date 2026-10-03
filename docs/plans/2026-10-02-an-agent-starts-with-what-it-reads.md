# An agent starts with the context it reads

> Every Plot session, fleet worker and subagent starts with an 82k-character table it does not read, and every fleet worker also carries a claude.ai connector list it does not use. Both are paid again on every request. This plan removes them, keeps them from returning, and measures the change with a method a second reader can repeat.

## Status

- **State:** Delivered
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** infra
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Started:** 2026-10-02, jwloka, `infra/the-helper-table-leaves-claude-md`
- **Started:** 2026-10-03, jwloka, `infra/a-worker-starts-without-unused-context`
- **Started:** 2026-10-03, jwloka, `docs/the-master-agent-briefs-rather-than-forks`
- **Delivered:** 2026-10-03

## Changelog

- Plot's helper-script reference moves to `skills/plot/scripts/README.md`, and `CLAUDE.md` names it in two lines. A CI check keeps the table out of `CLAUDE.md`.

<!-- Board impact: none. The board reads `## Plot Config`, which stays in CLAUDE.md. Slices 2 and 3 change only this repository's own configuration (.plot/agent-settings.json, .plot/worker-prompt.sh, CLAUDE.md), so they publish no changelog entry. -->

## Motivation

Measured 2026-10-02 with `python3 ~/claude-usage-report.py` (sha256 `a0071a2ef5332a5b…`, read-only over local transcripts), 2026-10-01 00:00 to 2026-10-02 14:30 Europe/Zurich. "Weighted" is input-equivalent tokens: input ×1, output ×5, cache write 5m ×1.25 and 1h ×2, cache read ×0.1.

| fact | value |
|---|---|
| total weighted spend, all projects | 514M |
| Plot's share (repo, worktrees, scratchpads) | 84% |
| the master session, with its subagents | 293M (57%) |
| fleet workers (`claude -p`), all projects | 29% |
| first-request context of a Plot session / worker / subagent | 125k / 123k / 94–103k |
| `CLAUDE.md` | 137,491 chars; `## Helper Scripts` is 82,596 of them (60%) |
| `CLAUDE.md` growth in the week before | +36.5k chars, 26.4k of them in the table |
| claude.ai connector list in a worker's first request | 47,385 chars in 10 of 12 workers checked; the one without it started at 98k tokens, the others at 113.5k–123.3k |
| worker context growth | linear, about 100k → 350–420k over 170–270 requests, no compaction |
| `fork` subagents in the master session | 34, starting at a median 336k, 84M weighted (16% of all spend) |
| `general-purpose` subagents in the master session | 65, starting at a median 100k, 75M weighted, all on Opus |

Cost scales with context size times request count. No code reads the Helper Scripts table: no gate, test, skill, CI step or worker prompt parses it. Only briefs mention it, as an instruction to add a row. A second, stale copy with 11 rows sits in `AGENTS.md:38`, which `plot-config.sh` falls back to and a non-Claude harness loads.

The changes remove context the model does not use. They do not lower reasoning effort or the model tier where a judgement is made.

## Design

### Approach

**1. The helper table leaves `CLAUDE.md`, and a gate keeps it out** (slice 1, ships in Plot).
- `skills/plot/scripts/README.md` is new and holds the table unchanged. `CLAUDE.md` keeps two lines in its place: the file's path, and the rule "a new script gets a row there". `AGENTS.md:38`'s stale table becomes the same pointer.
- `## Plot Config` stays in `CLAUDE.md`, because `plot-config.sh` and `agent-log.ts` read keys from it.
- **The README is excluded from the deliverable search.** `plot-deliverable-search.sh` searches `skills/plot/scripts` (`:115`), and an 82k-character table there would match almost every `/plot-idea` search. The slice adds the file to the excludes, with a test that a term naming a script does not match the README.
- **`scripts/check-helper-table.sh` is the gate.** It refuses a `## Helper Scripts` section or a `` | `plot- `` table row in `CLAUDE.md`, and it refuses a shipped script or bundle that has no row in the README. Today 14 of 59 `.sh` scripts and 19 of 36 `board/*.mjs` bundles have none. So the row check is a ratchet: it starts at 33 missing rows and fails when the number grows.
- The briefs on `main` that name the old table are history and stay as written. Where `/plot-implement`'s brief step names the table, it names the new file.

**2. A fleet worker starts without the connector list and unused plugins** (slice 2, this repository's configuration).
- **The connector list first.** It is the largest removable item, and a settings file cannot remove it. The slice adds `--strict-mcp-config` to `.plot/worker-prompt.sh` only after it measures one worker started with the flag:
  - the claude.ai connector tools are gone from its first request (`deferred_tools_delta`);
  - the plugin MCP tools workers used since 2026-09-28 are still there;
  - the invocation reads as intended under `PLOT_PRINT_INVOCATION=1`.
- **Then the plugins.** "Used" means any `Skill` call, slash command, `Agent` `subagent_type`, MCP tool or hook output in the worker transcripts since 2026-09-28; on 2026-10-02 that was 243 transcripts. A plugin with no such use is switched off in `.plot/agent-settings.json`.
- **Kept, with the reason recorded:**
  - **superpowers:** the user-level `CLAUDE.md` names its `executing-plans` and `brainstorming` skills;
  - **oh-my-claudecode:** workers spawned its `code-reviewer` and called its MCP tools.
  The slice records the per-start cost of each kept plugin: oh-my-claudecode adds 13.6k chars of `hook_success` and 10.6k of `hook_additional_context`. The slice states this repository's measurement only; a second operator's plugin set is theirs to measure.
- `agentSettingsRefusal` bounds the file: no `plot@…: false`, no `disableAllHooks`, no `env` key.

**3. The master agent briefs rather than forks above ~200k context** (slice 3, this repository's `CLAUDE.md`).
- A fork starts with the parent's whole context, a median 336k here. A briefed `general-purpose` agent starts at about 100k.
- `CLAUDE.md` › *The Master Agent Uses The Controllers* gains the rule: above about 200k context, start a `general-purpose` agent with a written brief instead of a fork. Mechanical subtasks (search, git, test runs, verification) run with `model: sonnet`, which applies `## Model Tiers` to Agent calls.
- **This is a rule, not a gate.** The spawn decision happens inside a model turn, and no hook reads the parent's context size. What makes it checkable is a measurement seven days after it lands (Done when).

### Measurement

- **The method a second reader can repeat.** For slices 1 and 2, one controlled pair: a `claude -p` worker start on `main` before the slice and the same start after it, on the same machine, with the same prompt and settings except the change. Record the first-request token count of both from their transcripts.
- **The fleet figures** from `~/claude-usage-report.py` are recorded beside each controlled pair, with the script's sha256 and its raw output in Notes. The script stays outside the repository, because it reads one person's transcripts.
- Slice 1 is measured before slice 2 merges, so the two effects stay separate.

## Done when

- Slice 1: `CLAUDE.md` is at least 80,000 chars smaller than its parent commit. `scripts/check-helper-table.sh` runs in CI and passes. `AGENTS.md` holds the pointer. The README is excluded from the deliverable search, and a test proves it. The controlled pair shows the first-request drop, and Notes records it.
- Slice 2: the controlled pair with `--strict-mcp-config` shows the connector list gone and the used plugin MCP tools present, or Notes records why the flag was not adopted. `.plot/agent-settings.json` switches off every plugin with no use by the definition above. Notes lists each kept plugin with its reason and per-start cost.
- Slice 3: the rule stands in `CLAUDE.md`'s master-agent section. Seven days after it merges, Notes records the master session's fork count and median fork start size, against 34 and 336k.

### Open Questions

- [ ] Does `--strict-mcp-config` also remove plugin MCP servers that workers use? If it does, slice 2 either names them in an MCP config passed to the worker or keeps the connector list and records why.

## Slices

### The helper table leaves CLAUDE.md

- `infra/the-helper-table-leaves-claude-md` — moves `## Helper Scripts` to `skills/plot/scripts/README.md`, points `CLAUDE.md` and `AGENTS.md` to it, excludes it from the deliverable search, adds `scripts/check-helper-table.sh` to CI <!-- builds: skills/plot/scripts/README.md and scripts/check-helper-table.sh --> → #1238

### A worker starts without unused context

- `infra/a-worker-starts-without-unused-context` — measures and adopts `--strict-mcp-config` in `.plot/worker-prompt.sh`; switches off, in `.plot/agent-settings.json`, every plugin no worker used → #1241

### The master agent briefs rather than forks

- `docs/the-master-agent-briefs-rather-than-forks` — the spawn rule and the Sonnet tier for mechanical subtasks in CLAUDE.md's master-agent section, measured seven days after it lands → #1254

## Notes

- 2026-10-02: drafted from a hand-off brief written in the quaweb-website session, which held the measurements above.
- 2026-10-02, round 1 (panel: skeptic, operator, domain; all `amend`, `.plot/panels/2026-10-02-an-agent-starts-with-what-it-reads/round1.md`). Slice 1 now covers `AGENTS.md`, gains a gate and a deliverable-search exclusion, and measures its size by difference. Slice 2 starts with the connector list. Its "used" counts subagents, MCP and hooks, and it keeps superpowers and oh-my-claudecode. Measurement is a controlled pair, with the usage script's hash and raw output recorded. The operator dropped the reviewer-charter slice, because panel jurors run as plain Agent calls and no charter governs them.
- 2026-10-03, slice 1's controlled pair (the slice's evidence). One `claude -p` start before the move and one after, same machine, same prompt (`Reply with exactly: ok`), same model (`claude-sonnet-5`), same `--permission-mode bypassPermissions`, first request's input read from each transcript. BEFORE on `origin/main` in a detached worktree, `CLAUDE.md` 139,389 chars, session `e5502636`: input 2 + cache_creation 100,247 + cache_read 25,374 = **125,623 tokens**. AFTER on `infra/the-helper-table-leaves-claude-md`, `CLAUDE.md` 55,287 chars, session `7044619e`: input 2 + cache_creation 69,903 + cache_read 25,374 = **95,279 tokens**. **Delta 30,344 tokens on every agent's first request, 24.2%.** `cache_read` is identical in both, so the whole difference is the context the move removed. The saving EXCEEDS the 21,025 that 84,102 chars at 4 chars/token predicts, because the table is dense prose carrying 62 rows of backticked identifiers — a worse-than-average token ratio, which the estimate did not capture.
- 2026-10-03: `~/claude-usage-report.py` sha256 `a0071a2ef5332a5baef14834d26b320bf504a10c53bac4b28a4bc93e9d354615`. Its `--since 2026-10-03` output ranks both sessions independently: `e5502636` (BEFORE project `T/plot-measure-before.J2jZWU`) 1 prompt, 1 request, 125.63k tokens; `7044619e` (AFTER) 1 prompt, 2 requests, 193.76k total. The 2-request total is not the first-request figure; the per-request numbers above are read from the transcript rows.
- 2026-10-03, slice 2's controlled pair and plugin switch-off (`infra/a-worker-starts-without-unused-context`, → #1241). The new baseline is `origin/main` at `cb58fae60`, after slice 1 merged, so `CLAUDE.md` is already at 55,287 chars here — not slice 1's 139,389-char starting point.
  - **The flag, measured.** Same method as slice 1: one `claude -p` start before and one after, same machine, same prompt (`Reply with exactly: ok`), same model (`claude-sonnet-5`), same `--permission-mode bypassPermissions`, in a detached worktree on `cb58fae60`. BEFORE (no flag), session `06a9ce78`: input 2 + cache_creation 61,830 + cache_read 25,844 = **87,676 tokens**. Its `deferred_tools_delta` carries the claude.ai connector list (Atlassian, Claude Docs, Figma, …) and oh-my-claudecode's 55 plugin MCP tools under the `mcp__plugin_oh-my-claudecode_t__*` prefix. AFTER (`--strict-mcp-config`, no `--mcp-config`), session `ff24dfc3`: input 3 + cache_creation 5,319 + cache_read 15,043 = **20,365 tokens**, `deferred_tools_delta` empty — zero MCP tools of any kind, connector or plugin. This answers the plan's open question: yes, the flag removes plugin MCP servers too.
  - **Outcome (a), tried and not adopted.** Passed `--mcp-config` naming oh-my-claudecode's bridge server (`{"mcpServers":{"t":{"command":"node","args":["<plugin-cache-path>/oh-my-claudecode/5.6.0/bridge/mcp-server.cjs"]}}}`) alongside `--strict-mcp-config`. Session `0b9e8eed`: input 2 + cache_creation 50,869 + cache_read 30,750 = **83,621 tokens**, all 55 oh-my-claudecode MCP tools present and the connector list gone. Not adopted anyway, for two reasons found during the measurement, neither anticipated by the plan: the server's `args` path is pinned to the plugin's installed version (`5.6.0` on this machine, inside `~/.claude/plugins/cache/`), which `.plot/worker-prompt.sh` would have to hardcode and which breaks silently on the next plugin update; and loading the server this way bypasses the plugin loader's namespacing, so every tool's prefix changes from `mcp__plugin_oh-my-claudecode_t__*` to `mcp__t__*` — a rename anything hardcoding the old name would miss. Neither cost is worth the 4,055-token saving over the unflagged baseline.
  - **Outcome (b), adopted.** `--strict-mcp-config` is not added to `.plot/worker-prompt.sh`. The connector list stays; the file is unchanged. `PLOT_PRINT_INVOCATION=1` was not re-verified for this flag, because it was not added.
  - **The used-set, re-derived from transcripts rather than trusted from the plan's four-day-old list.** Scanned 384 fleet-worker transcripts (`~/.claude/projects/*worktrees*` and `*-wt-*`, `.jsonl` files modified since 2026-09-28) with a structural parse of `tool_use` blocks — not substring grep, which false-positives on every session's own "available agents/skills" catalog listing (95 files mention `pr-review-toolkit` by name in that listing alone, zero of them call it). Findings: **`superpowers`** — `Skill` calls to `executing-plans`, `test-driven-development`, `using-superpowers`, plus one `Agent subagent_type: superpowers:code-reviewer`. **`oh-my-claudecode`** — 7 `Agent subagent_type: oh-my-claudecode:code-reviewer` calls; no MCP tool call by any worker, of oh-my-claudecode's or anyone else's — the only `mcp__*` names appearing anywhere in the 384 files are `mcp__claude_ai_Claude_Docs__*` inside `deferred_tools_record` (tool *availability*, not a call). This corrects the plan's stated reason for keeping oh-my-claudecode ("workers... called its MCP tools"): they do not; the Agent spawns and the per-call hook cost (`hook_success`/`hook_additional_context`, unchanged from the plan's 13.6k/10.6k chars) are the actual reasons. **`learning-output-style`** — fires on every worker via its `SessionStart` hook (239 of 384 sessions read `'learning' output style mode`; the other 207 read `'explanatory'` from a different plugin version or project). Not named in the plan; added to the kept set because it is a real, structural use signal (hook output), and `.plot/agent-settings.json` is this repository's file, so this repository's evidence governs it. **`plot`** is excluded from the used/unused question entirely: `agentSettingsRefusal` refuses any `plot@…: false` regardless of use, so it was never a candidate.
  - **Switched off**, no use signal found: `agent-admin@quatico-internal-marketplace`, `bdd-methodology@quatico-internal-marketplace`, `code-review@claude-plugins-official`, `code-simplifier@claude-plugins-official`, `commit-commands@claude-plugins-official`, `document-skills@anthropic-agent-skills`, `elements-of-style@superpowers-marketplace`, `figma@claude-plugins-official`, `frontend-design@claude-plugins-official`, `playwright@claude-plugins-official`, `pr-review-toolkit@claude-plugins-official`, `quatico-internal@quatico-internal-marketplace`, `quatico-skills@quatico-marketplace`, `slack@claude-plugins-official`, `working-with-bitbucket-api@quatico-marketplace`, `working-with-jira-web@quatico-marketplace`.
  - **Kept, with reason and per-start cost:** `superpowers@superpowers-marketplace` — Agent spawn of its `code-reviewer` and Skill calls to `executing-plans`/`test-driven-development`/`using-superpowers`; per-start cost not separately measured this round. `oh-my-claudecode@omc` — Agent spawn of `code-reviewer`; per-start cost unchanged from the plan's figure, 13.6k chars of `hook_success` + 10.6k of `hook_additional_context`. `learning-output-style@claude-plugins-official` — fires its `SessionStart` hook on every worker; per-start cost not separately measured this round. `episodic-memory@superpowers-marketplace` was already `false` before this slice (slice 0 of this file, predating the plan) and stays `false`.
  - **This repository's measurement only**, per the plan's own rule — a second operator's enabled-plugin set is theirs to scan.
- 2026-10-03, slice 3 landed (`docs/the-master-agent-briefs-rather-than-forks`, → #1254). The rule stands in `CLAUDE.md`'s *The Master Agent Uses The Controllers* section, mirrored to `AGENTS.md`. The seven-day measurement (master session's fork count and median fork start size, against 34 and 336k) is due on or after 2026-10-10.
