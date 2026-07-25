---
name: challenge-the-plan
description: "Systematically interrogate implementation plans through a bounded interview covering technical, domain, UX, and non-functional dimensions to uncover gaps and validate decisions. Use when: user wants to challenge, refine, or validate a plan, spec, or idea. Triggers: challenge the plan, challenge me, quiz me, interview me, refine plan, validate plan, review plan, interrogate plan, stress-test plan, challenge the spec, challenge the story, review spec, review story."
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: "1.0.1"
  source: "Adopted from quatico-solutions/agent-skills"
compatibility: Designed for Claude Code and Cursor.
---

# Challenge the Plan

> **Reads an implementation plan and interviews you systematically across all dimensions to uncover gaps, validate assumptions, and refine decisions.**

## Setup

Optional. In a project using Plot, the question budget can be set in the
`## Plot Config` section of `CLAUDE.md`:

    ## Plot Config
    - **Challenge question budget:** 16

| Key | Default | Meaning |
|-----|---------|---------|
| `Challenge question budget` | `16` | Maximum questions (4 rounds × 4) before the interview must stop and write up. `0` disables the bound. |

Sixteen is one question per category-progression stage plus a round of slack. A
plan needing more than sixteen questions to reach a decision is a plan that needs
rewriting, not more interviewing.

This skill also runs standalone, outside a Plot project. If
`../plot/scripts/plot-config.sh` is not present, use the default of 16 — a missing
config helper is not an error and must not stop the interview.

## Input

**$ARGUMENTS**: `./path/to/PLAN.md` (optional)

1. If `$ARGUMENTS` provides a file path, read that file as the plan
2. If empty, search the current working directory for files matching:
   - `PLAN.md`, `PLAN-*.md`, `*-PLAN.md`
   - `SPEC.md`, `SPEC-*.md`, `*-SPEC.md`
   - `STORY.md`, `STORY-*.md`, `*-STORY.md`
3. If no match in cwd, auto-detect the most recent plan file in:
   - `~/.claude/plans/` (Claude Code)
   - `./.cursor/plans/` (Cursor)
4. If nothing detected, ask the user which file to challenge — do NOT proceed without a confirmed plan file

## Execution Workflow

### Phase 1: Plan Discovery

1. Resolve plan file (from argument or auto-detect)
2. Read plan content
3. Parse structure to identify sections, decisions, and assumptions
4. Check for an existing "Open Points" section (indicates a previous session)

### Phase 2: Initial Analysis (first run only)

Scan plan for:
- Implicit assumptions (words like "will", "should", "could" without justification)
- Technical decisions lacking rationale
- Business logic without domain validation
- UX flows missing edge case handling
- Non-functional risks (security, performance, scalability)

### Phase 3: Question Generation (4 per round)

Generate 4 questions focused on a single category or cross-cutting theme:

**Technical (Stack -> Architecture -> Implementation)**
- Stack: Why this framework/library? What are alternatives?
- Architecture: How do components communicate? Where does logic live?
- Implementation: Error handling? Edge cases? Rollback strategy?

**Domain (Business Rules & Workflows)**
- What defines valid entities and constraints?
- Who can perform operations? Authorization rules?
- Complete entity lifecycle?
- Workflow triggers and state management?

**UX (Happy -> Edge -> Error -> Accessibility)**
- Happy path: User journey when everything works
- Edge cases: Rapid clicks, unusual input, navigation away
- Error states: Error messages, recovery, debugging
- Accessibility: Screen readers, keyboard nav, color contrast

**Non-Functional (Hypothesis-Driven)**
- Security: Input sanitization, authorization, credential storage
- Performance: Response times, query optimization, indexing
- Scalability: Traffic spikes, rate limits, horizontal scaling

**Trade-offs**
- What alternatives were considered? Why rejected?
- What's the downside of the chosen solution?
- What would trigger reconsidering this decision?

**Material-vs-marginal filter.** Before asking a question, apply this test:

> If the answer were the opposite of what I expect, would the plan change?

Ask it only if the answer is yes. A question whose every plausible answer leaves
the plan identical is marginal — it produces documentation, not decisions.

| Material — ask | Marginal — do not ask |
|----------------|----------------------|
| Which of two approaches, where the choice changes the branch structure | Confirming a decision the plan already states with rationale |
| An unstated constraint that would invalidate the approach | An edge case whose handling is obvious from the stated approach |
| A dependency or integration that may not exist | Detail that can be decided during implementation without rework |
| Scope the plan is silent on, where silence is ambiguous | Restating a known trade-off in different words |

Prefer the four most material questions available over four questions that cover
four different categories. Category coverage is a heuristic for finding material
questions, not a goal. **Do not ask a question to complete a category.**

Depth is capped by the budget, not by the supply of questions. There is always
another question; that is precisely why a bound is needed.

### Phase 4: Interview Execution

Use the structured question tool to present 4 questions per round:
- Claude Code: `AskUserQuestion` tool
- Cursor: `ask_question` tool

**Question format:**
1. Each question gets 2-4 concrete choices (A/B/C/D)
2. Complex questions include: "I don't know / leave as open question for the team"
3. "Other" option is automatically provided by the tool for free-form text
4. Track question history to prevent redundancy

**Deferral options** (for complex questions):
- "I don't know"
- "Let's discuss with the team"
- "Leave question for [name]" (e.g., "Leave question for a colleague")

Collect deferred responses for the Open Points section.

### Phase 5: Plan Refinement

**Narrative Weaving Principles:**
1. **No meta-commentary**: Don't add "Validated:" or "Interview finding:" markers
2. **Natural integration**: Expand existing sections with details as if always there
3. **Maintain voice**: Keep plan's original writing style and tone
4. **Add detail, not sections**: Enrich existing content rather than appending

Update the original plan file with refined content.

### Phase 6: Completion Check

Read the budget once at start:
`../plot/scripts/plot-config.sh get "Challenge question budget" 16`

If that helper is not present (standalone use, outside a Plot project), use `16`.

Stop when **any** of these is true — not all of them:

1. The user says "done", "complete", or "satisfied".
2. The question budget is exhausted.
3. The last full round produced no answer that changed the plan.

Rule 3 is the substantive one. Track it: after each round, ask whether any answer
caused an edit to the plan's shape — a decision reversed, a branch added or
removed, a constraint discovered, an approach rejected. If a whole round of four
questions produced only elaboration of things already decided, the interview has
reached diminishing returns. Stop there.

There is deliberately no "no gaps remain" condition. You cannot verify the absence
of gaps, and treating it as a stopping rule means never stopping. Unasked
questions belong in Open Points, where a human can see them and decide.

On stopping, report: questions asked, budget, which rule fired, and what remains in
Open Points.

### Phase 7: Open Points Review (before completion)

Re-ask all deferred questions for final validation. Remove resolved items from the Open Points section.

## Open Points Tracking

Deferred questions are tracked as a plain text section appended to the plan file:

```markdown
## Open Points

- [ ] [Technical] How to handle token refresh race conditions? — *deferred: discuss with the team*
- [ ] [Domain] What authorization rules apply to admin users? — *deferred: leave question for Egemen*
- [ ] [UX] What happens when session expires mid-form-fill? — *deferred: I don't know*
- [x] [Security] Where are credentials stored? — *answered round 3: Vault with rotation*
```

**Tracking rules:**
1. After each round, append new deferred items to Open Points
2. When a deferred item gets answered in a later round, mark it `[x]` with the answer
3. If no Open Points section exists, create it at the end of the plan file
4. On completion, remove fully-resolved items (keep only genuinely open ones)

## Output

Original plan file updated with:
- Validated decisions woven naturally into narrative
- Technical rationale for choices
- Domain rules explicitly documented
- UX flows expanded with edge case handling
- Non-functional considerations integrated
- Trade-off analysis for major decisions
- Open Points section for unresolved items

No separate interview report — plan refinement is self-documenting.

## When to Use

- You have a plan that feels "complete" but want rigorous validation
- You need to ensure no assumptions are left unquestioned
- You want to document decision rationale comprehensively
- You're about to implement and want confidence in the approach
- You want the team to see what questions remain open
