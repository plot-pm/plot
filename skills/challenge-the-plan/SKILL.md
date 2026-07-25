---
name: challenge-the-plan
description: "Systematically interrogate implementation plans through adaptive depth interviews covering technical, domain, UX, and non-functional dimensions to uncover gaps and validate decisions. Use when: user wants to challenge, refine, or validate a plan, spec, or idea. Triggers: challenge the plan, challenge me, quiz me, interview me, refine plan, validate plan, review plan, interrogate plan, stress-test plan, challenge the spec, challenge the story, review spec, review story."
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

**Question Complexity Assessment:**
- **Complex** (include "I don't know / leave for team" option):
  - Questions requiring domain expertise
  - Questions with significant trade-offs
  - Questions about future concerns
  - Questions about non-obvious edge cases
- **Simple** (no deferral needed):
  - Yes/No validations
  - Confirming stated facts
  - Choosing from clear alternatives
  - Obvious constraints

**Tone Adaptation:**
- **Neutral**: Information gathering (happy path flows)
- **Skeptical**: Challenging assumptions (security, edge cases)
- **Socratic**: Complex trade-offs (architecture decisions)

**Audience Adaptation:**
- **Technical phrasing**: Implementation details, code organization
- **Business phrasing**: Requirements, user needs, domain rules

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

**Example Transformation:**

Before:
```
## Authentication
We'll use JWT tokens for authentication. Users log in and receive a token.
```

After:
```
## Authentication
We'll use JWT tokens for authentication with a 15-minute access token expiry and 7-day refresh token. Users authenticate via email/password, receiving both tokens stored in httpOnly cookies to prevent XSS attacks. When multiple tabs are open, token refresh is coordinated via BroadcastChannel API to avoid race conditions. If a user's session expires mid-form-fill, we preserve form state in sessionStorage and restore after re-authentication via a modal overlay (no redirect, preventing data loss).

The alternative of session-based auth was rejected due to horizontal scaling requirements—JWT allows stateless authentication across multiple API servers without session store synchronization overhead.
```

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

## Adaptive Depth Strategy

**Round 1: Surface Scan**
- Identify sections with decisions but no rationale
- Find unvalidated assumptions
- Detect missing error handling
- Flag vague requirements

**Round 2+: Adaptive Deepening**
- Detailed answers: Continue at current depth
- Frequent deferrals: Pivot to different category
- Terse answers: Ask Socratic follow-ups
- Gaps filled: Move to next category

**Category Progression:**
1. Technical (Stack -> Arch -> Impl)
2. Domain (Rules -> Workflows -> Data)
3. UX (Happy -> Edge -> Error -> A11y)
4. Non-functional (Security -> Perf -> Scale)
5. Trade-offs (Alternatives -> Rationale -> Risks)

**The progression is a search order, not a checklist.** Five categories at four
questions per round would be 20 questions — more than the default budget of 16.
That is intentional: the budget binds first, and it should. Walk the categories
looking for material questions, and skip any category where the material-vs-marginal
filter finds none. A plan with no UX surface does not owe the interview four UX
questions.

Most plans will not visit every category. That is a correct outcome, not an
incomplete interview.

## Question Templates

### Technical - Stack Level
- "Why [framework X] instead of [alternative Y]? What's the decision rationale?"
- "How does [library] integrate with existing [component]?"
- "What's the upgrade path if [dependency] becomes unmaintained?"

### Technical - Architecture Level
- "How does [component A] communicate with [component B]?"
- "Where does [business logic] live - controller, service, or domain model?"
- "How is [state] synchronized across [contexts]?"

### Technical - Implementation Level
- "What happens when [operation X] fails mid-process?"
- "How are [edge cases] handled in [function]?"
- "What's the rollback strategy if [transaction] fails?"

### Domain - Business Rules
- "What defines a valid [entity]? What constraints must hold?"
- "Can [action A] and [action B] happen simultaneously? What should occur?"
- "Who can perform [operation]? What authorization rules apply?"

### Domain - Workflows
- "What's the complete lifecycle of [entity] from creation to deletion?"
- "Which user actions trigger [workflow]? Are there batch/scheduled triggers?"
- "Can [workflow] be paused and resumed? What state needs persisting?"

### UX - Happy Path
- "What does the user see when [action] succeeds?"
- "How many clicks/steps from [start] to [goal]?"
- "What feedback confirms [operation] completed?"

### UX - Edge Cases
- "What if user clicks [button] twice rapidly?"
- "What if form has [unusual input] like emoji, very long text, or special chars?"
- "What if user navigates away mid-[process]?"

### UX - Error States
- "What error message appears when [validation] fails?"
- "Can user recover from [error] without losing work?"
- "Does [error] log to monitoring? How will devs debug?"

### UX - Accessibility
- "How do screen reader users navigate [component]?"
- "Can [workflow] be completed keyboard-only (no mouse)?"
- "Do [error messages] have sufficient color contrast?"

### Non-Functional - Security
- "How is [user input] sanitized before [database/rendering]?"
- "What prevents [unauthorized user] from accessing [resource]?"
- "Where are [credentials/secrets] stored? Are they encrypted?"

### Non-Functional - Performance
- "What's the expected response time for [operation]?"
- "How does [feature] perform with [large dataset]?"
- "Are [queries] indexed? What's the query plan?"

### Non-Functional - Scalability
- "How does [component] handle 10x traffic spike?"
- "Are there rate limits on [API endpoint]?"
- "Can [operation] be horizontally scaled?"

### Trade-offs
- "What alternatives to [approach] were considered? Why rejected?"
- "What's the downside of [chosen solution]?"
- "What would make you revisit this decision?"

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
