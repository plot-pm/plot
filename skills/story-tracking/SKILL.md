---
name: story-tracking
description: "Use when user says \"continue on\", \"work on\", \"create story\", \"new story\", \"resume\", or references a JIRA ticket for multi-session work. NOT for Storybook UI component stories."
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: "1.1.1"
  source: "Adopted from quatico-solutions/agent-skills"
compatibility: Designed for Claude Code and Cursor. Requires git.
---

# Story Tracking

Multi-session work items tracked in markdown folders, linked to JIRA tickets.

**Not Storybook:** These "stories" are work tracking documents (like epics/tasks), not UI component stories.

## Markdown Standards

Standard CommonMark only, no GFM extensions (task lists, strikethrough) — some forges (e.g. Bitbucket) don't render them. If the project has a markdown-conventions skill, follow it.

## Structure

Stories live in the project's **story directory** — the `Story directory` key
in `## Plot Config`, default `docs/stories/`. Read it, never assume it:

    ../plot/scripts/plot-config.sh get "Story directory" docs/stories/

```
<story directory>/
├── {slug}/              # Active story
│   ├── STORY-{slug}.md  # Main file (required)
│   ├── analysis-*.md    # Auxiliary files (optional)
│   └── assets/          # Screenshots, diagrams
└── archived/            # Completed stories (see Archiving a Story)
    └── {slug}/
```

**Naming:** `{slug}/` or `{JIRA-ID}-{slug}/` (e.g., `wcag-audit/`, `FOOBAR-1234-wcag-audit/`)

**Sub-unit homes.** A repo that aggregates several areas may carry one story
directory per area, at the same relative path (`clients/acme/stories/`,
`teams/blue/stories/`). List the ones that exist with

    git ls-files '*STORY-*.md' | sed -E 's#/[^/]+/STORY-[^/]+$##' | sort -u

Ask git rather than the filesystem: `ls-files` reports only what *this*
repository tracks, so it never wanders into a submodule or an ignored
directory. A story belongs to **the unit that owns the outcome** — not the one
that happens to host the code. That is a judgement about the work, not about
paths; make it deliberately.

### Resuming a Story

1. Search every story home for the slug or JIRA prefix —
   `git ls-files '*STORY-*.md' | grep -i {slug}`
2. Read `STORY-*.md` for: plan status, open points, decisions, last session
3. Check auxiliary files for additional context
4. Summarize current state before proceeding

### Creating a Story

A story is created **before** its work exists, so its home cannot be derived
from anything on disk. Decide it once, out loud:

1. Look at which homes exist (the `git ls-files` command above shows them all)
2. **Name the home you intend and why, and get confirmation** — one sentence,
   e.g. "This looks estate-wide rather than specific to one area, so
   `teams/blue/stories/`. Create it there?" Skip the question only when the
   repo has exactly one home
3. Create folder: `<chosen home>/{slug}/`
4. Copy the story template → `STORY-{slug}.md`
5. Fill frontmatter — including `unit:`, the owning unit, so the placement
   survives review — and the objective; remove unneeded sections
6. Add an entry to "Active Stories" in the file named by `Story index`
   (default `README.md`). There is **one** index per repo and it covers every
   home: a story in a sub-unit home is listed there too, with its full path,
   under that unit's subheading. An index buried inside the story directory is
   the one nobody reads
7. Commit and push

### Archiving a Story

When a story's work is fully done (and any resulting PRs/tickets are closed),
archive it so the story directory shows only live work:

1. **Settle the story file** — all phases marked ✅, final decisions and a
   closing session-log entry recorded.
2. **Set frontmatter** — `status: done` and add `archived: {YYYY-MM-DD}`.
3. **Move the folder by location** (status is self-evident from where it lives).
   The home is the story's own grandparent directory — derive it from the file
   you are archiving rather than from config, so a story living in a sub-unit
   home archives beside itself:

   ```bash
   story=clients/acme/stories/beta/STORY-beta.md   # the file being archived
   home=$(dirname "$(dirname "$story")")           # clients/acme/stories
   slug=$(basename "$(dirname "$story")")          # beta
   git mv "$home/$slug" "$home/archived/$slug"
   ```

4. **Repoint inbound links** — sessionlogs, plans, or rules that link the story
   now point to `<home>/archived/{slug}/`. Grep for the old path to catch
   them all.
5. **Update the index** — move the entry out of "Active Stories" in the repo's
   `Story index` file (to an "Archived" list, or remove it).
6. **Commit and push** — a single `git mv` keeps history intact.

Reverse by moving the folder back and clearing `archived:` if a story reopens.

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

### Story Index

One index per repo, in the file named by `Story index` (default `README.md`).
It covers **every** home, including sub-units:

`- {status} [{slug}](<home>/{slug}/STORY-{slug}.md) — [JIRA-ID](url)`

Group entries under a per-unit subheading when the repo has several homes.
Maintain: add on create, update status on change, move to archived when done.

### Updating Stories

1. **Story file**: Update status markers, add decisions with rationale, append session summary
2. **Index**: Update the status marker in "Active Stories"
3. **Changelog** (`docs/changelogs/YYYY-MM.md`): High-level entry — if the
   project routes these elsewhere (some keep a yearly summary instead), follow
   the project's own rule
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

Add story tracking rules to your project's `CLAUDE.md` — see [agent-instructions.md](agent-instructions.md) for a ready-to-paste template, and declare `Story directory` and `Story index` in `## Plot Config`. Copy [STORY-template.md](STORY-template.md) into your project's template location.

### Session Wrap-up

Before ending a session: ensure the story has updated status, decisions, and a
session summary. If a session wrap-up skill (such as `bye`) is installed, it
handles the changelog entry and final commit.
