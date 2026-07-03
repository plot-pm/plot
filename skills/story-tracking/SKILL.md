---
name: story-tracking
description: "Use when user says \"continue on\", \"work on\", \"create story\", \"new story\", \"resume\", or references a JIRA ticket for multi-session work. NOT for Storybook UI component stories."
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: "1.0.0"
  source: "Adopted from quatico-solutions/agent-skills"
compatibility: Designed for Claude Code and Cursor. Requires git.
---

# Story Tracking

Multi-session work items tracked in markdown folders, linked to JIRA tickets.

**Not Storybook:** These "stories" are work tracking documents (like epics/tasks), not UI component stories.

## Markdown Standards

Standard CommonMark only, no GFM extensions (task lists, strikethrough) — some forges (e.g. Bitbucket) don't render them. If the project has a markdown-conventions skill, follow it.

## Structure

```
docs/stories/{slug}/
├── STORY-{slug}.md      # Main file (required)
├── analysis-*.md        # Auxiliary files (optional)
└── assets/              # Screenshots, diagrams
```

**Naming:** `{slug}/` or `{JIRA-ID}-{slug}/` (e.g., `wcag-audit/`, `FOOBAR-1234-wcag-audit/`)

### Resuming a Story

1. Find folder in `docs/stories/` by slug or JIRA prefix
2. Read `STORY-*.md` for: plan status, open questions, decisions, last session
3. Check auxiliary files for additional context
4. Summarize current state before proceeding

### Creating a Story

1. Create folder: `docs/stories/{slug}/`
2. Copy `docs/templates/STORY-template.md` → `STORY-{slug}.md`
3. Fill frontmatter and objective, remove unneeded sections
4. Add entry to "Active Stories" in `README.md`
5. Commit and push

### Template Sections

Use contextually — not every story needs every section:

| Section | Use When |
|---------|----------|
| **Phases** | Multi-day work |
| **Key Findings** | Discoveries changed understanding |
| **Excluded from Scope** | Intentionally deferring items |
| **Progress Tracking** | Multi-repo or multi-PR work |

### Status Markers

| ✅ Complete | 🔄 In progress | 🟡 Needs attention | ⏸️ Paused | ❌ Cancelled |

### README Index

"Active Stories" section in `README.md`:
`- {status} [{slug}](docs/stories/slug/STORY-slug.md) — [JIRA-ID](url)`

Maintain: add on create, update status on change, remove when done.

### Updating Stories

1. **Story file**: Update status markers, add decisions with rationale, append session summary
2. **README**: Update status marker in "Active Stories"
3. **Changelog** (`docs/changelogs/YYYY-MM.md`): High-level entry
4. **Commit**: `docs: update {story-slug} — {description}`, push immediately

### Session Log

Captures agent sessions AND meeting notes (humans write directly). Read all recent entries when resuming.

### Auxiliary Files

Create when detailed content would clutter main file:
- `analysis-{topic}.md` — root cause analysis, investigation findings
- `plan-{topic}.md` — deferred plans, phased implementation details
- `testing-plan.md` — manual test protocols with expected outcomes
- `meeting-{date}.md` — meeting notes, decisions from discussions
- `script/` — test scripts, debug tools, automation helpers
- `assets/` — screenshots, diagrams, log files

### Git Strategy

- Work on the project's default branch
- Commit and push after significant changes

### Project Integration

Add story tracking rules to your project's `CLAUDE.md` — see [agent-instructions.md](agent-instructions.md) for a ready-to-paste template. Copy [STORY-template.md](STORY-template.md) to `docs/templates/` in your project.

### Session Wrap-up

Before ending a session: ensure the story has updated status, decisions, and a
session summary. If a session wrap-up skill (such as `bye`) is installed, it
handles the changelog entry and final commit.
