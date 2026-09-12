---
name: challenge-the-plan
description: "Systematically interrogate implementation plans through adaptive depth interviews covering technical, domain, UX, and non-functional dimensions to uncover gaps and validate decisions. Use when: user wants to challenge, refine, or validate a plan, spec, or idea. Triggers: challenge the plan, challenge me, quiz me, interview me, refine plan, validate plan, review plan, interrogate plan, stress-test plan, challenge the spec, challenge the story, review spec, review story."
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: "1.3.2"
  source: "Adopted from quatico-solutions/agent-skills"
compatibility: Designed for Claude Code and Cursor.
---

# Challenge the Plan

> **Reads an implementation plan and interviews you systematically across all dimensions to uncover gaps, validate assumptions, and refine decisions.**

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

## Two engines, one surface

**The questioning is parallel or sequential; the skill, the Open Questions
section and the `Rounds:` record are the same either way.**

| | **Interview** (Phases 3–4) | **Panel** (Phase 3P) |
|---|---|---|
| shape | 4 questions per round, one at a time | N lenses at once, each writing a file |
| needs | a person answering | nobody |
| subject | the plan | the plan **and its siblings** |
| output | Open Points + `Rounds:` | Open Points + `Rounds:` |

**Measured 2026-09-12 on this repo: 268 plans, 73 carrying a `Rounds:` field —
27.2%.** That is a cost measurement rather than a verdict on interviewing. Rounds
are serial and each one spends a person's attention, so the uptake measures what
that attention costs. The panel is the unattended shape of the same question.

**The interview is not replaced.** A person who wants to answer questions
directly still can, and every one of the 73 existing rounds came from that mode.
Deleting it would delete the only engine with a track record.

**A second interrogation surface was the alternative and it is refused.** Plans
would get challenged two ways and neither would be authoritative. One surface,
two engines.

### Choosing the engine

- **`PLOT_UNATTENDED=1`** → the panel. The interview has no shape with nobody to
  interview; Phase 4 already says so and stops.
- **A person is present** → ask which, and default to the interview. It is the
  mode with 73 rounds behind it, and a person who invoked this skill directly is
  the resource the panel exists to spare.

> **Unattended (`PLOT_UNATTENDED=1`):** run the panel. This is the case the
> panel was built for, and the interview's own unattended note stops rather than
> guessing — so with nobody present there is exactly one engine that can run.
> `PLOT-UNASKED: Interview or panel? — default — panel run; the interview needs a person to answer`

## Execution Workflow

### Phase 1: Plan Discovery

1. Resolve plan file (from argument or auto-detect)
2. Read plan content
3. Parse structure to identify sections, decisions, and assumptions
4. Check for an existing "Open Points" section (indicates a previous session)
5. Extract the `CHALLENGE-THE-PLAN-METADATA` block to reconstruct round state
   (see [Phase 5b](#phase-5b-record-the-round)) — its `round` is where the count
   resumes, so a second interrogation continues from it rather than restarting

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

### Phase 3P: Panel (the parallel engine)

**Runs instead of Phases 3–4, never beside them.** A plan questioned twice in one
run would count two rounds for one interrogation.

This phase **calls [`/plot-panel`](../plot-panel/SKILL.md) and implements none of
it.** The verdict gate, the commitment check and the reconciler belong to that
mechanism. If you find yourself parsing a verdict file here, stop: that is the
mechanism's job and a second copy will drift from it.

> **If `skills/plot-panel/` is absent, this phase cannot run.** That is a broken
> or partial installation, not a clean panel — say so and fall back to the
> interview rather than reporting a plan as questioned. Absent is not false.

#### The subject: the plan and its siblings

**A plan is questioned alone, so a contradiction between siblings is invisible.**
Measured in this story's own preparation: a plan proposed fixing a per-board cap
that `fleet.ts:2691` already read from the shared registry. A juror holding the
sibling plans would have seen it.

Resolve the sibling set:

```bash
# The active sprint, if there is one.
SPRINT=$(ls docs/sprints/active/*.md 2>/dev/null | head -1)
```

- **A sprint is active** → its members are the siblings.
- **No sprint is active** → every unfinished plan (phase neither `Delivered` nor
  `Released`) is the sibling set.

**Measured 2026-09-12: sprint `an-agent-is-declared-and-corrected` is Active with
10 items, and 11 plans on the estate are unfinished.** So the sprint arm is the
normal case today and the fallback is the exception — the reverse of what this
plan assumed when it was written. **Both arms are built**; the rule is unchanged.

**The set is bounded and the panel names what it dropped.** Order the siblings
**most recently amended first** (`git log -1 --format=%cI -- <plan>`), take up to
N, and **state in the output how many went unread**:

```
siblings: 10 read, 0 unread (sprint an-agent-is-declared-and-corrected)
```

**A panel that silently truncates is a panel whose blind spot is invisible** —
`plot-reconcile-scan.sh`'s rule, that a finding is reported rather than decided.
With 10 sprint members the bound may not bind today; the report of what was
dropped is still owed, because it is what makes the bound safe when it does.

**The subject parameter stays ONE plan.** `/plot-panel` refuses a directory or a
cohort by design — *"four personas asked to interrogate a scheduling cohort
produce four answers with no shared subject."* The siblings are **context in the
rubric**, not additional subjects.

#### The lenses

Four is a guess and nobody has measured it — **the first real number comes from
running this.** Do not hardcode one in the mechanism; it takes N.

| Lens | The reading position |
|---|---|
| **Estate** | Does this already exist? Read the siblings and the estate before the plan's claim that it does not. |
| **Contradiction** | Does this disagree with a sibling plan, or with a decision this repo already made? |
| **Deliverable** | Does every slice name something that ships, and does the changelog describe what the slices actually build? |
| **Cost** | What does this spend — attention, CI, blast radius — and is the plan honest about it? |

**Brief each juror to look, not to agree.** A juror told *"you are the estate
lens"* and asked what it finds is doing the job; one told *"find duplication"*
will find some whether or not it is there.

**These lenses are this caller's and do not transfer.** An estate lens asking
*does this already exist?* is meaningless at delivery, where the thing is built.
They live here and not in `packages/domain/`.

**Prose quality is deliberately not a lens.** A juror reporting awkward wording
alongside a missed deliverable dilutes both.

#### The commitment

```
Position: proceed | amend | reject
```

**`/plot-panel` knows none of these words** — it takes the label and the
vocabulary as parameters and validates against them. That is what makes the
delivery caller possible with a different vocabulary.

#### Running it

Hand `/plot-panel` its four parameters — Subject, Lenses, Commitment, Rubric —
and let it fan out, gate every verdict and reconcile. **Read the exit code, not
the emptiness**: `plot-panel.mjs` exits `3` for a refusal and `2` for unusable
arguments, and a missing bundle means the panel ran ungated rather than clean.

The rubric is **identical across lenses**; only the persona line differs. If you
are writing a second rubric for a second lens, the lens is doing work the rubric
should.

#### What the panel writes back

The moderation at `.plot/panels/<subject>/panel.md` is the panel's own artifact.
This phase then does what an interview round does, and **nothing more**:

1. **Open Points** — each juror's unresolved finding becomes an open point, in
   the section this skill already owns. A `reject` is recorded with the lens that
   holds it, because that is what a later round must clear.
2. **Phase 5b, unchanged** — one round, recorded by exactly the rule below.

**A panel round that changed nothing is still a round.** Absent and `0` are
deliberately different: absent means nobody looked.

**`Rounds:` does not yet distinguish a panel round from an interactive one.** They
are not equivalent work, and a second field is a plan-format change that needs its
own argument — it is not invented here.

> **Unattended (`PLOT_UNATTENDED=1`):** run the whole phase. Fan out, gate,
> reconcile, write Open Points and record the round. The panel exists for this
> case, and every sub-decision below it has a defined default — except acting on
> a divided panel, which `/plot-panel` itself stops on.
> `PLOT-UNASKED: The panel is divided — proceed on the majority, or hold? — stopped — moderation and round written, nothing approved`

### Phase 4: Interview Execution

Use the structured question tool to present 4 questions per round:
- Claude Code: `AskUserQuestion` tool
- Cursor: `ask_question` tool

> **Unattended (`PLOT_UNATTENDED=1`):** stop before the first round, and write
> nothing to the plan. This skill is an interview — the answers *are* the
> output, and there is no shape of it that survives having nobody to interview.
> An unattended run that answered its own questions would produce the most
> dangerous artefact this repo can make: a plan that looks interrogated,
> carrying an agent's guesses under a human's name.
>
> Do the half that needs no one. Report the gaps the analysis found and the
> questions the first round would have asked, so a person can answer them in
> one pass rather than rediscovering them.
> `PLOT-UNASKED: <n> interrogation questions across <dimensions> — stopped — questions listed; plan unchanged`
>
> See [Running unattended](../plot/docs/unattended.md).

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

### Phase 5b: Record the round

**This runs at the end of every round, before the completion check — and it runs
even when the round changed no decision.** The count is the record that the plan
was interrogated; a round that survives scrutiny unchanged is still a round, and
must still be counted. A plan that reads as unexamined for having answered every
question cleanly is the exact failure this step prevents.

**The round is owed by anyone who interrogates a plan, whether or not this skill
did the interrogating** — an interrogation conducted directly writes `- **Rounds:**
N` to `## Status` by the same rule below, and needs no metadata block to do it.

State lives in a single HTML comment in the plan file, keyed on the
`CHALLENGE-THE-PLAN-METADATA` sentinel:

```html
<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "Why JWT over sessions?", "a": "Stateless scaling", "category": "technical"}
  ],
  "deferredItems": [
    {"q": "Token refresh race conditions?", "category": "technical", "context": "Auth section"}
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

**Read, modify, write — never append a second block:**

1. At the start of the run (Phase 1) read the plan and extract the block by
   regex: `<!-- CHALLENGE-THE-PLAN-METADATA\n(.*?)\nEND-CHALLENGE-THE-PLAN-METADATA -->`.
   Parse the JSON to reconstruct state. If there is no block, start fresh at
   `round: 0`.
2. At the end of each round, increment `round` by 1, append this round's
   questions to `questionHistory`, update `deferredItems` and
   `categoriesCovered`, and write the block **in place** — replace the existing
   block, do not append a new one. A second block would freeze the count: the
   parser reads only the first `"round":` line it finds.
3. **In the same step, write `- **Rounds:** N` to `## Status`** using the same
   incremented value. This is the field a person reads; the block is machine
   state. Both writes, one value — they cannot disagree by construction.

   **The write is replace-or-insert-after-`Impl:`, and touches nothing else:**
   - If a `- **Rounds:**` line exists in `## Status` → replace that line
   - If it does not → insert `- **Rounds:** N` immediately after `- **Impl:**`

   Never a rewrite of the section, never a reflow, never an insert computed from
   a line number. `## Status` holds `State:`, `Type:`, and the `Approved:` /
   `Started:` / `Delivered:` / `Released:` transition records — facts nothing in
   the repo can reconstruct. A greedy match there destroys history.
4. The block must stay a multi-line HTML comment with `round` on its own line as
   `"round": <integer>` — that exact line is the only thing `plot-plan-meta.sh`
   reads out of the block, and it reports it as the plan's `rounds`. A
   single-line `<!-- … -->` block is treated as a placeholder and produces no
   count.

The count is the deliverable: `plot-plan-meta.sh` surfaces it as `rounds` and
the board renders it as a `1 round` / `N rounds` badge. Absent and zero are
deliberately different — an absent block means nobody has looked, `0` would mean
interrogated and found nothing. This step never writes a plan without at least
one completed round, so it never emits `0`; it starts counting at the first
round's end.

### Phase 6: Completion Check

Exit when:
1. User explicitly says "done", "complete", or "satisfied"
2. All categories covered comprehensively AND
3. No more gaps detected in plan AND
4. All open questions have been answered

If not complete, return to Phase 3 with adaptive depth.

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
