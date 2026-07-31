---
title: {TITLE}
author: {NAME}  # Who owns/drives this story — always set it; multi-author repos depend on it
jira: {JIRA_TICKET_URL}  # Optional — link (never copy) the tracking ticket
status: draft | ready | active | in-review | paused | done
created: {YYYY-MM-DD}
updated: {YYYY-MM-DD}
# archived: {YYYY-MM-DD}  # Add when done + moved to <story directory>/archived/ (see Archiving a Story)
---

# {TITLE}

## Objective

{What this work aims to achieve — 1-3 sentences}

## Why Now

{Optional — what makes this worth doing at this moment: the trigger, the
window, the cost of waiting. Delete if the Objective already says it.}

## Decisions Taken in Scoping

{Optional — decisions made while shaping this story, before any plan
exists (Q&A form works well). Later decisions go to the Decisions table;
this block preserves the founding choices that are easy to lose.}

## Current Plan

{Active plan — updated as work progresses. Use phases with status markers for larger work:}

### Phase 1: {Name} ✅

- ✅ Task 1 (`commit-sha`) — 2026-02-05
- ✅ Task 2

### Phase 2: {Name} 🔄

- 🔄 Task 3 — in progress
- ⏸️ Task 4 — pending

{For simpler work, a bullet list is fine:}

- ✅ Completed item
- ⏸️ Pending item

## Open Points

- ⏸️ {Questions needing resolution}
- ✅ {Resolved question} → See Decisions

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| {YYYY-MM-DD} | {What was decided} | {Why — include who confirmed if relevant} |

## Key Findings

{Use when discoveries change understanding or scope. Skip if work is straightforward.}

### {YYYY-MM-DD} — {Title}

**Expected:** {What we thought}

**Discovered:** {What we found}

**Impact:** {How this affects the plan}

## Excluded from Scope

{Use when intentionally deferring or excluding work. Prevents re-debates.}

| Item | Reason | Revisit If |
|------|--------|------------|
| {Feature/component} | {Why excluded} | {Condition to reconsider} |

## Progress Tracking

{Use for multi-repo or multi-PR work. Skip for single-file changes.}

| Repo/Area | PR | Ticket | Status | Notes |
|-----------|----|----|--------|-------|
| {repo-name} | [#123](url) | FOOBAR-456 | ✅ Merged | — |
| {other-repo} | — | FOOBAR-457 | 🔄 In progress | Blocked by #123 |

## Session Log

{Captures both agent sessions AND meeting notes written by humans.}

### {YYYY-MM-DD} — {Brief topic}

{Summary of what was explored/decided/changed}

**Key outcomes:**

- {Outcome 1}
- {Outcome 2}

---

### {YYYY-MM-DD} — Team sync (meeting notes)

{Notes from offline discussion — written directly by humans}

**Discussed:**

- {Topic 1}

**Action items:**

- ⏸️ {Follow-up task}

---
