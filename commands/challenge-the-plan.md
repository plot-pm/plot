---
name: challenge-the-plan
description: Systematically interrogate implementation plans through adaptive depth interviews covering technical, domain, UX, and non-functional dimensions to uncover gaps and validate decisions
---

# /challenge-the-plan - Deep Plan Interrogation

This command reads your most recent implementation plan and interviews you systematically across all dimensions to uncover gaps, validate assumptions, and refine decisions.

## Execution Workflow

### Phase 1: Plan Discovery
1. Auto-detect most recent plan file in `~/.claude/plans/`
2. Read plan content and extract any existing metadata from HTML comment
3. Parse plan structure to identify sections, decisions, and assumptions

### Phase 2: Initial Analysis (if first run)
Scan plan for:
- Implicit assumptions (words like "will", "should", "could" without justification)
- Technical decisions lacking rationale
- Business logic without domain validation
- UX flows missing edge case handling
- Non-functional risks (security, performance, scalability)

### Phase 3: Question Generation (4 per round)
Generate 4 questions focused on single category or cross-cutting theme:

**Technical (Stack → Architecture → Implementation)**
- Stack: Why this framework/library? What are alternatives?
- Architecture: How do components communicate? Where does logic live?
- Implementation: Error handling? Edge cases? Rollback strategy?

**Domain (Business Rules & Workflows)**
- What defines valid entities and constraints?
- Who can perform operations? Authorization rules?
- Complete entity lifecycle?
- Workflow triggers and state management?

**UX (Happy → Edge → Error → Accessibility)**
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
- **Complex** (include "Mark for later" option):
  - Questions requiring domain expertise
  - Questions with significant trade-offs
  - Questions about future concerns
  - Questions about non-obvious edge cases
- **Simple** (no "Mark for later" needed):
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

### Phase 4: Interview Execution
1. Use AskUserQuestion with 4 questions (tool limit)
2. Each question has 2-4 options (A/B/C/D)
3. Include "Mark for later" option only for complex questions
4. "Other" option automatically provided by tool for freeform text
5. Track question history to prevent redundancy
6. Collect "Mark for later" responses separately

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

Update original plan file with refined content.

### Phase 6: Completion Check
Exit when:
1. User explicitly says "done", "complete", or "satisfied"
2. All categories covered comprehensively AND
3. No more gaps detected in plan AND
4. All deferred items have been answered

If not complete, return to Phase 3 with adaptive depth.

### Phase 7: Deferred Items Review (before completion)
Re-ask all "Mark for later" questions for final validation.

## State Persistence

State is tracked via HTML comment embedded in plan file:

```html
<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {"q": "Why JWT over sessions?", "a": "Stateless scaling", "category": "technical"},
    {"q": "Token expiry duration?", "a": "15min access, 7day refresh", "category": "technical"}
  ],
  "deferredItems": [
    {"q": "How to handle token refresh race conditions?", "category": "technical", "context": "Authentication section"}
  ],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": false},
    "domain": false,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
```

**State Reconstruction:**
1. Read plan file
2. Extract metadata comment (regex: `<!-- CHALLENGE-THE-PLAN-METADATA\n(.*?)\nEND-CHALLENGE-THE-PLAN-METADATA -->`)
3. Parse JSON to reconstruct state
4. If no metadata, initialize fresh state
5. After each round, serialize state back to metadata comment
6. Update metadata in place (Edit tool on plan file)

## Adaptive Depth Strategy

**Round 1: Surface Scan**
- Identify sections with decisions but no rationale
- Find unvalidated assumptions
- Detect missing error handling
- Flag vague requirements

**Round 2+: Adaptive Deepening**
- Detailed answers → Continue at current depth
- Frequent "Mark for later" → Pivot to different category
- Terse answers → Ask Socratic follow-ups
- Gaps filled → Move to next category

**Category Progression:**
1. Technical (Stack → Arch → Impl)
2. Domain (Rules → Workflows → Data)
3. UX (Happy → Edge → Error → A11y)
4. Non-functional (Security → Perf → Scale)
5. Trade-offs (Alternatives → Rationale → Risks)

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

## Implementation Notes

- **Question history tracking**: Prevents re-asking substantially similar questions across rounds
- **Deferred items**: "Mark for later" responses collected and re-asked in final review round
- **Adaptive depth**: Starts with gaps/assumptions, digs deeper based on user engagement
- **Many rounds expected**: ~5-10 rounds for comprehensive coverage due to 4-question limit

## Output

Original plan file updated with:
- Validated decisions woven naturally into narrative
- Technical rationale for choices
- Domain rules explicitly documented
- UX flows expanded with edge case handling
- Non-functional considerations integrated
- Trade-off analysis for major decisions

No separate interview report—plan refinement is self-documenting.

## When to Use

Use this command when:
- You have a plan that feels "complete" but want rigorous validation
- You need to ensure no assumptions are left unquestioned
- You want to document decision rationale comprehensively
- You're about to implement and want confidence in the approach
