# Round 1: operator

Position: amend

Lens: the operator, who runs the board, the supervisor and the fleet on one machine and reads `CLAUDE.md` as the reference. All `git` readings are against `origin/main` at `a6f49c232`.

## Findings

### 1. The measured facts hold

- `git show origin/main:CLAUDE.md | wc -c` gives 137,491. The `## Helper Scripts` section (CLAUDE.md:183–253) is 82,596 chars, which is 60%. At about 4 chars per token, the section is about 20k tokens.
- `.plot/agent-settings.json` holds only `"episodic-memory@superpowers-marketplace": false`. The mechanism works. Of 39 `sdk-cli` worker transcripts since 2026-10-01, 0 carry `episodic-memory` in their first 400k chars, and 39 of 39 carry `figma`, `frontend-design`, `document-skills`, `slack`, `elements-of-style`, `pr-review-toolkit`, `playwright`, `oh-my-claudecode` and `superpowers:` (scan.py and scan3.py in my scratch dir).
- No code, test, gate or skill reads the table from `CLAUDE.md`. `git grep "Helper Scripts"` outside plans and briefs finds `AGENTS.md:38`, `CHANGELOG.md`, sessionlogs, a superpowers plan and the sprint file. No file under `test/`, `scripts/`, `packages/*/test` or `skills/*/SKILL.md` reads the repo's own `CLAUDE.md` for script rows. `plot-config.sh` and `agent-log.ts` read only `## Plot Config`. Open Question 1 is therefore already answered: nothing reads the table, so nothing must change to read the new file.

### 2. Slice 1 puts the table inside a search corpus

- `plot-deliverable-search.sh:115` searches `packages/*/src skills/plot/scripts scripts`. The script excludes only itself (`:153`), because its own header names the duplications it searches for.
- `skills/plot/scripts/README.md` would name every script and carry 82k chars of prose about them. Every `/plot-idea` step-3 search would then match that file for almost any term, and that buries the per-corpus signal the script was built to give (see its `gh` example).
- The fix is one exclude line, or a location outside the corpus such as `docs/helper-scripts.md`.

### 3. Nothing keeps the table out, and it grows fast

- `CLAUDE.md` grew from 100,974 chars (`2dfa6eb25`, 2026-09-25) to 137,491 (`d1cea0fb2`, 2026-10-02). 34 commits touched it in that week.
- Over the same week the table grew from 56,187 to 82,578 chars. The rest of the file grew by about 10k chars.
- The plan's own sizes give 137,491 − 82,596 + a two-line pointer, which is about 55.1k. That leaves about 900 chars of slack against the 56k target. At the measured growth of the rest of the file (about 1.4k chars a day), slice 1 misses its target if it lands a day late.
- Six briefs on `main` tell agents to "add a row to the Helper Scripts table in `CLAUDE.md`". The pointer line is prose, so it is a rule. The repo's *Gates Over Rules* section predicts that a rule like this fails.

### 4. `AGENTS.md` carries a second, stale copy

`AGENTS.md:38` has its own `## Helper Scripts` table. The file is 12,026 chars and lists seven scripts with older text. The plan does not mention it. A Codex or Cursor harness reads `AGENTS.md`, and after slice 1 it would point at stale descriptions while `CLAUDE.md` points at the new file.

### 5. Slice 2: the method disables more than the candidate list

I scanned 243 main-session transcripts in `*plot--worktrees*` directories since 2026-09-28 (scan.py and scan2.py):

- **`Skill` tool calls:** 0.
- **`<command-name>` slash invocations:** 0.
- **`Agent` calls:** 3 in total — `superpowers:code-reviewer` 1, `oh-my-claudecode:code-reviewer` 1, `general-purpose` 1.
- **MCP calls:** 3, all from `mcp__plugin_oh-my-claudecode_t`.

The rule "disable each enabled plugin that no worker used" therefore disables almost every enabled plugin: superpowers, all quatico plugins, `playwright`, `commit-commands`, `code-review`, `bdd-methodology` and `agent-admin`. That is far more than the eight named candidates.

That outcome may be right, but the plan should decide it explicitly. Two consequences need a decision:

- **The user-level `~/.claude/CLAUDE.md` names skills a worker would no longer have.** It tells agents to run approved plans through `executing-plans` and to start creative work with `brainstorming`, both from superpowers. Workers ignore that today (0 invocations), but after slice 2 the instruction would name a skill the worker does not have. The superpowers and omc code-reviewer subagents were each used once.
- **"Used" must count more than `Skill` calls.** It must also count `Agent` `subagent_type`, MCP tools and hooks. Otherwise the slice disables a plugin whose subagent a worker did spawn.

As the operator, I see what a worker loses: one optional code-reviewer subagent per about 120 sessions, and omc's notepad and state tools. No Plot gate depends on these plugins. The gates arrive through `plot@…`, which `agentSettingsRefusal` (`packages/domain/src/rules/agent-settings.ts`) already protects.

**Not affected, but worth recording:** `skills/ralph-plot-sprint/SKILL.md:266` calls `/pr-review-toolkit:review-pr`. `ralph-sprint.sh` starts `claude -p` without `--settings`, so it is unaffected today. Record it in slice 2 so that nobody routes ralph through the settings file later.

**Out of reach for a settings file:**

- claude.ai connectors (`claude_ai_` appears in 37 of 39 worker transcripts). The plan already covers these with `--strict-mcp-config`.
- org-provisioned skills (`sales:`, `small-business:` and others appear in 5 of 39). The plan does not name these.

### 6. The savings cannot be verified from the repo

- `~/claude-usage-report.py` lives in the operator's home directory, untracked (21,458 bytes, 2026-10-02 14:33). A reviewer cannot re-run the Motivation numbers, and a later edit to the script changes the baseline without a record.
- "Median first-request context of a new worker" mixes briefs of different lengths. If slices 1 and 2 merge close together, the drop cannot be attributed to either one.

### 7. Slice 3 is a rule, and its Done-when checks only that the prose exists

The plan says honestly that slice 3 is a rule. But its Done-when is satisfied by writing a paragraph. As the operator, I can only see the rule being followed in transcripts. `claude-usage-report.py` already reports fork count and fork start size, so the outcome can be measured.

### 8. Order and independence

Slices 2 and 4 are independent. Slices 1 and 3 both edit `CLAUDE.md`, in different sections, so a textual conflict is unlikely. The open risk is measurement attribution (finding 6), not merge order. Slice 4 is sound as written.

## Amendments

1. **Slice 1, location.** Add `skills/plot/scripts/README.md` to the `excludes` in `plot-deliverable-search.sh` in the same slice, with a test that a term naming a script does not match the README. Or move the table to a path outside the deliverable corpora, for example `docs/helper-scripts.md`.
2. **Slice 1, gate.** Add a CI check, `scripts/check-helper-table.sh`, that refuses a `| \`plot-` table row or a `## Helper Scripts` table in `CLAUDE.md`. In the same slice, add a check that every `skills/plot/scripts/*.sh` has a row in the new file. That turns "a new script gets a row there" into a gate.
3. **Slice 1, Done-when.** Replace "at most 56k chars" with "`CLAUDE.md` is at least 80,000 chars smaller than its parent commit, and the gate in amendment 2 is green". Keep 56k only as a reported figure.
4. **Slice 1, `AGENTS.md`.** Replace `AGENTS.md:38`'s stale table with the same two-line pointer.
5. **Slice 2, the set.** State which set the slice disables: the eight candidates, or the method's full result. List each kept plugin and the reason. Define "used" as any `Skill` call, slash command, `Agent` `subagent_type`, `mcp__plugin_<name>_*` call, or a hook the gates need, counted over `sdk-cli` worker transcripts since 2026-09-28. Record the superpowers decision against the user-level `executing-plans` instruction. Record that `ralph-sprint.sh` bypasses the file and needs `pr-review-toolkit` if routed through it.
6. **Measurement.** Commit the usage report script, for example as `scripts/usage-report.py`, or record its sha256 in Notes with each figure. For slices 1 and 2, measure a controlled pair instead of a fleet median: one `claude -p` in a fresh desk with a fixed one-line prompt, before and after, reading the first request's input tokens. Merge and measure slice 1 before slice 2 merges, so that each drop is attributed to one slice.
7. **Slice 3, Done-when.** Add: "Seven days after merge, Notes records the master session's fork count and median fork start size from the usage report, against 34 and 336k."
8. **Open Questions.** Close the first one with the `git grep` evidence in finding 1. Replace it with: "Does the new file sit inside a search corpus (`plot-deliverable-search.sh`), and is it excluded?"
