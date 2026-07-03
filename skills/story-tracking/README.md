# story-tracking

Development notes for the multi-session work tracking skill.

> **Provenance:** adopted 2026-07-03 from
> [quatico-solutions/agent-skills](https://github.com/quatico-solutions/agent-skills),
> where it was developed and battle-tested. Moved here because stories and
> plans are sibling concepts: plot plans track *approved, actionable* work;
> stories track the *long-running umbrella* around it (research, decisions,
> session narrative). A story can reference plot plans and vice versa.

## Purpose

Track complex, long-running tasks (features or bugfixes) that span multiple agent sessions. Originally designed to replace JIRA child tickets with markdown, the skill evolved into a general-purpose project archive — the story directory holds not just the narrative log but also scripts, test plans, analysis docs, and supporting artifacts.

## Design Decisions

### Story directory as project archive
Real-world usage showed that stories need more than a markdown file. The `script/`, `assets/`, and auxiliary file conventions emerged from actual projects where debug scripts, test protocols, and root cause analyses needed a home alongside the story log.

### CommonMark only (no GFM)
Task lists (`- [ ]`) were replaced with status emoji markers. The `markdown` companion skill enforces CommonMark + Bitbucket compatibility across all story documents.

### "Story" naming
The term caused repeated confusion with Storybook UI component stories. The disambiguation note in SKILL.md exists because of real misactivation — it stays.

### Session log for humans and agents
The session log captures both agent summaries and human meeting notes. Agents must read all recent entries when resuming, not just their own.

### Project-level agent rules required
The skill tells agents HOW to work with stories, but project CLAUDE.md rules tell them WHEN to checkpoint. Without always-on rules, agents batch updates and lose context across sessions. The `agent-instructions.md` template captures the minimum viable CLAUDE.md section learned from real usage.

### Skill composition
Depends on `markdown` (syntax rules) and `bye` (session wrap-up with changelog and final commit). `challenge-the-plan` auto-searches for STORY files.

## Related Skills

These live in [quatico-solutions/agent-skills](https://github.com/quatico-solutions/agent-skills);
the SKILL.md references them softly (works without them):

- `markdown` — syntax rules for all story documents
- `bye` — session wrap-up, changelog entry, final commit
- `challenge-the-plan` — auto-searches for STORY files
