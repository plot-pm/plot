# Round 1 — skeptic

Position: amend

The direction is right and slice 1 is real. Three things are wrong with the plan as written. The 56k target has about 1.4k chars of headroom against a file whose remaining sections grew 10k chars in six days. Slice 2 aims at the cheapest item and treats the largest one as optional. The worker baseline is noisier than the 15k drop it must show.

## Findings

### 1. Slice 1 removes what it claims, but the target is too tight and nothing holds it

- Measured on `origin/main` (`git show origin/main:CLAUDE.md`, split by `^## `): 137,491 bytes and 136,772 characters. `## Helper Scripts` is 82,176 characters (60.1%). The plan's 137,491 and 82,596 mix bytes with characters, but the share is right.
- After the move, the rest of the file is 54,596 characters plus a two-line pointer, which leaves about 1.4k characters under the 56k ceiling in `Done when`.
- The non-table part of CLAUDE.md grows fast. The command below measured these sizes. Total and table sizes are in bytes. Rest: 28,963 on 2026-09-01, 41,312 on 09-10, 44,787 on 09-20 and on 09-26, and 54,913 on 10-02. That is about +10k in the last six days. The table grew from 17,396 to 82,578 in one month. Command: `git rev-list -1 --before=<d> origin/main` then `awk '/^## Helper Scripts/…'`.
- Slice 3 adds text to the same file, so with slices in the stated order, slice 3 alone can push CLAUDE.md past 56k. Other merges in flight can do the same.
- The plan names no gate. The only thing that keeps new rows out is the prose pointer "a new script gets a row there". That is the same prose that let the table grow 4.7× in a month. The project's own `## Gates Over Rules` section says to turn this into a gate. Without one, the cost returns through other sections within weeks.
- No reader breaks. `git grep "Helper Scripts"` over `test scripts packages skills .github hooks` finds no reader. No test, CI step or skill parses the table (checked: `.github/workflows/ci.yml` mentions CLAUDE.md only in comments, at :639, :901 and :955). Six files under `.plot/briefs/` tell an agent to add a row, for example `.plot/briefs/the-merge-subject-is-one-rule.md`. The brief writer (`packages/board/src/server/brief-ask.ts`) and `skills/plot-implement/SKILL.md` never mention the table. The brief writer copies the instruction from CLAUDE.md itself, so the plan's "brief-writing step's text" change has no target. The pointer line in CLAUDE.md is the only lever, and the plan should say so.
- One detail is missing. `AGENTS.md:38` holds a third, stale `## Helper Scripts` table with 11 rows. `plot-boardctl.sh` reads AGENTS.md as a fallback (`test/reconcile/boardctl.test.mjs:461`). After slice 1 there are two tables that can drift, and the plan does not mention AGENTS.md.
- Agents lose this: a fleet agent no longer sees what each script does unless it opens the README. It gets nothing from script headers in its context. `plot-deliverable-search.sh` exists because plans kept rebuilding scripts the estate already had. The table was part of how an agent finds those scripts. The cost is acceptable, but the plan should state it.

### 2. Slice 2 targets the smallest item; the MCP connectors are the largest

Measured from the twelve most recent worker transcripts in `~/.claude/projects/*plot--worktrees-*` (2026-10-02). For each one, I took the first assistant message's `input + cache_creation + cache_read` and the sizes of the attachments written before it.

- **Skill listing: 36,433 chars, and the listing is budget-capped.** 114 of its 213 entries are shorter than 50 chars, so they carry no description. All eight candidate plugins together occupy about 1.1k chars of it: figma 365, slack 336, elements-of-style 262, document-skills 87, frontend-design 33, pr-review-toolkit 29. When those plugins are disabled, the freed budget goes to other skills' descriptions, so the token saving from the listing is close to zero. This is the case where the mechanism looks finished and the cost stays.
- **The connector list (`deferred_tools_delta`) is 47,385 chars in 10 of the 12 workers.** It is mostly claude.ai connectors (by tool count: Ahrefs 270, Resend 258, Microsoft 365 100, Atlassian 82, Gmail 60, HubSpot 56). The plan says 10–25k chars, so it understates the size by 2–4×. One worker at 2026-10-02T02:22 had a 793-char list. Its first request was 98,044 tokens against 113.5k–123.3k for the others. Removing the connectors is likely worth about 15–20k tokens, as much as slice 1. The plan makes it conditional on `--strict-mcp-config` and gives no fallback. Another possible route is an environment variable set in `.plot/worker-prompt.sh`, not in the settings file, because `agentSettingsRefusal` refuses any `env` key (`packages/domain/src/rules/agent-settings.ts`). The slice should test that route too.
- **The agent listing (`agent_listing_delta`) varies from 14,270 to 44,774 chars** between workers on the same day. A 30k-char swing that nobody controls is in the baseline. `code-simplifier` and `pr-review-toolkit` add agent definitions here, so these two may matter more than their skill-listing share suggests. The plan does not measure this.
- **oh-my-claudecode.** In worker `ce761bc3…` the hooks write `hook_success` SessionStart 10.8k chars and `hook_additional_context` SessionStart 9.9k chars, then about 5k of PreToolUse text over 41 Bash calls. The plan counts `hook_success` (13.6k) as context. Whether `hook_success` text reaches the model is not shown. Only `hook_additional_context` is certain. The slice must measure what reaches the request, not what the transcript records.
- **The settings file works.** No `episodic-memory` string appears in recent worker transcripts (`grep -c episodic` = 0), so `--settings` with `enabledPlugins: false` does remove a plugin. Commit `e7222ba86` added it on 2026-09-30.
- `agentSettingsRefusal` does not get in the way of disabling third-party plugins. It refuses only `plot@…: false`, `disableAllHooks` and `env`.

### 3. The baseline is too noisy for the slice 1 target

- On the same day, workers' first requests range from 113,564 to 123,332 tokens. Most of that spread is the agent listing and the connector list, not CLAUDE.md. A Done-when of "median falls ≥15k against 123k" can pass or fail because of attachment variance, and so can slice 2 merging close to slice 1.
- `~/claude-usage-report.py` lives outside the repository. It has no "median first-request context per worker" or "fork start size" output (`grep -n` shows sections for spend, context growth and hook text only). A second reader cannot reproduce the Verification step.

### 4. Slices 3 and 4 put the largest costs under the weakest mechanisms

- Forks are 16% of spend and the master session is 57%. Slice 3 handles both with a rule the plan itself calls not a gate. That is honest, but the plan has no check for it. Nothing measures fork count or fork start size after slice 3.
- Slice 4 runs one panel on Opus and one on Sonnet. It keeps Sonnet only if "every juror's position and named findings match". It has no Opus-vs-Opus control, so run-to-run variance on the same model will fail the comparison. "Named findings match" has no definition. The likely result is a full panel run that changes nothing, aimed at about 2% of spend.

### 5. The plan has no projected saving

The Motivation gives shares but no expected result. A rough estimate: 20k tokens is about 8% of an average worker request (context grows from about 123k to about 350k). Fleet workers are 29% of spend, so slice 1 is worth about 2–3% of total weighted spend from workers, plus a similar share from sessions and subagents. Without a stated prediction, the Verification step cannot say whether the plan worked.

## Amendments

1. **Slice 1 adds a gate.** Add a CI step, modelled on the existing ratchets in `ci.yml`, that fails when CLAUDE.md grows past a recorded ceiling. Set the ceiling from the post-move size plus slice 3's addition, not a hand-picked 56k. In the same slice, add a CI check that fails when CLAUDE.md contains a `| \`plot-…\` |` table row.
2. **Change the slice 1 Done-when** from "at most 56k" to "at most the ceiling the gate records". State the slice 3 allowance explicitly, or put slice 3 before slice 1.
3. **Measure slice 1's token effect directly.** Count the tokens of the moved text with the API's token-counting endpoint, and compare worker first requests only between workers with identical `deferred_tools_delta` and `agent_listing_delta` sizes. Drop "median ≥15k against 123k".
4. **Slice 1 also handles AGENTS.md.** Replace AGENTS.md's stale table with the same pointer, or state why it stays.
5. **Change the brief-writing text in slice 1.** The only lever is the CLAUDE.md pointer line, so word it as an instruction: "a new script gets a row in `skills/plot/scripts/README.md`". State that `brief-ask.ts` and `/plot-implement` need no change.
6. **Re-order slice 2 by measured size.** First the claude.ai connector list (measured 47k chars; one worker without it started 15–25k tokens lower), then the agent listing, then oh-my-claudecode's `hook_additional_context`, and the skill-listing plugins last. Correct "10–25k chars" to the measured 47,385. Name a fallback if `--strict-mcp-config` fails: an environment variable set in `.plot/worker-prompt.sh`. Record that disabling plugins saves almost nothing in the skill listing, because the listing is budget-capped (114 of 213 entries carry no description).
7. **Slice 2's Done-when names its measurement:** the first-request attachment sizes (`deferred_tools_delta`, `agent_listing_delta`, `skill_listing`, SessionStart `hook_additional_context`) before and after, from one named worker each. "No worker used it" is a precondition, not the result.
8. **Commit the measurement method.** Commit the usage-report script, or the exact extraction (first assistant message `input + cache_creation + cache_read`, attachment sizes before it), to the repo or the plan's Notes, so a second reader can repeat the Verification step.
9. **Slice 4 adds an Opus-vs-Opus control run and defines "match"** as the same position plus the same set of cited file:line findings. If the two Opus runs disagree with each other, the slice records that the comparison cannot decide, and the charter stays.
10. **Add a predicted saving to Motivation**, in weighted tokens or as a share of spend per slice, so the Verification step can confirm or refute it.
11. **Add an Open Question:** "Does a fleet agent that adds a script still find the existing ones without the table in context?" Answer it from `plot-deliverable-search.sh` findings after slice 1.
