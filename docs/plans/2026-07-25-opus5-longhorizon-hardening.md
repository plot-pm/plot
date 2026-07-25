# Harden Plot against documented Opus 5 long-horizon failure modes

> Bound the automated sprint runner and the plan-interrogation interview, make delivery gates mechanically verifiable, and record which model class the skills were tuned against.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->

## Approval

- **Approved:** 2026-07-25T13:13:51Z
- **Approved by:** jwloka
- **Assignee:** jwloka

## Changelog

- `ralph-plot-sprint` gains a declarative budget surface — `max iterations`, `deadline`, `heartbeat interval`, `stall limit`, and an `on budget exhausted` enum (`ship_partial | fail`) — plus a deliverable rubric evaluated by the runner and a verifier agent, replacing agent self-report.
- `challenge-the-plan` gains a question budget, a material-vs-marginal filter, and a falsifiable stopping rule.
- `plot-deliver` gate language tightened so every gate is verifiable from git/forge state rather than from the agent's own claim of completion.
- `plot-reconcile` read-only-ness stated as a design invariant rather than a description of current behaviour.
- New `## Plot Config` keys: `Sprint max iterations`, `Sprint deadline`, `Sprint heartbeat interval`, `Sprint stall limit`, `Sprint on budget exhausted`, `Challenge question budget`. All optional, all with documented defaults.
- A deletion pass removes 1,616 words of canned templates, taste rules, a worked example, inline query bodies, and rules restated as warnings. Net across the touched files is **−33** (12,389 → 12,356) — the config surface and rubric add literal text, and the deletions more than cover it.
- Docs record the model class the skills were authored and tuned against.

<!-- Board impact: NONE. This plan touches no plan-format field, not the plan
     template, not docs/plans layout, and not plot-plan-meta.sh. The one helper
     script touched (plot-config.sh) gains no new parsing rules — the three new
     keys use the existing documented grammar. packages/board consumes plan
     metadata, which is unchanged. No board rebuild required. Verified by
     reading .plot/templates/plan.md and skills/plot/scripts/plot-config.sh. -->

## Motivation

The Claude Opus 5 System Card (Anthropic, 24 July 2026) documents long-horizon
agentic failure modes. Plot is a skill system driven by exactly such an agent, and
one of its skills — `ralph-plot-sprint` — is an unattended loop. Where the system
card's documented failures have a structural analogue in this repo, the analogue
should be bounded.

This plan proposes those bounds. It changes no lifecycle, adds no command, and
adds no skill.

**Source verification is part of this plan.** Every finding below was checked
against the PDF; two did not survive contact with the source and are corrected
rather than built upon. See [Source Verification](#source-verification).

## Source Verification

Retrieved: `https://www-cdn.anthropic.com/c5fbac3f0b1280a933ebd26d3cb8bb9f5bdeaf48/Claude%20Opus%205%20System%20Card.pdf`
(16 MB; too large for the fetch tool's 10 MB cap, so converted locally with
`pdftotext` and read as text). Section numbering below is the PDF's own.

### Verified as briefed

**§2.2.6 is real and says what the brief claims — but it is not a section about
agentic coding.** §2.2.6 is *Conclusions* under **§2.2 CB evaluations**
(chemical/biological risk). The findings appear there as *limitations that reduce
Opus 5's usefulness for biological research*, which is what makes them a
capability caveat rather than a safety finding. The observed behaviours generalise;
the framing should not be misreported.

Quoted verbatim from §2.2.6:

> **Unproductive self-verification:** The model is prone to descending into
> exhaustive correctness checks, often developing elaborate verification pipelines
> that distract from the primary task. In several instances, the model was unable
> to complete the task within its allocated time budget after spending hours
> attempting to debug a verification pipeline developed before results actually
> landed.

> **Poor calibration of task scope:** Whereas the model proactively identifies
> failure modes and edge cases in existing codebases, it tends to over-engineer and
> over-emphasize the importance of marginal changes that do not impact the overall
> quality of the code.

The campaign experiment, also §2.2.6, verbatim:

> Mythos 5 delivered all 30 designs, ranked and internally audited. Neither Claude
> Opus 5 arm delivered: one shipped 17 unranked designs after abandoning the
> selectivity goal partway through; the other shipped nothing and went silent for
> its final 8 hours. Unlike Mythos 5, Claude Opus 5 consistently got stuck in
> self-verification loops instead of producing designs.

Two details differ from the brief and matter for how the finding is cited:

1. The campaign is a **24-hour, $10,000 protein-design campaign** (30 protein
   binders targeting GDF-8 while ignoring GDF-11) — not a generic "design
   campaign". It is a *small series of experiments*, explicitly "not implemented
   at scale".
2. The comparison model is **Mythos 5**, and the two failing runs are **two
   replicate Opus 5 arms at different effort settings (max and high)** — not
   two independent campaigns. Findings 1–3 are therefore n=2 on an *early
   snapshot*, which is weak evidence for a strong claim. It is enough to justify
   cheap bounds; it is not enough to justify expensive redesign. This plan is
   scoped accordingly.

### Corrected — finding 4 does not hold as briefed

The brief attributes overconfidence and hallucination to **§6.5**. §6.5 exists
(*Honesty and hallucinations*) with the subsections named — §6.5.1 Factual
hallucinations, §6.5.3 Uncritically reporting flawed results, §6.5.4 Overconfidence,
§6.5.5 Lazy investigation. **But §6.5 mostly reports Opus 5 improving, not
regressing:**

- §6.5.3 — "Claude Opus 5 identifies issues in these evaluations **in all
  instances** in this testbed, performing at the same level as Opus 4.8 and Mythos 5."
- §6.5.4 (Overconfidence) — "Claude Opus 5 **exceeds all previous models** on this
  evaluation, essentially saturating it."
- §6.5.5 (Lazy investigation) — "Claude Opus 5 is the **first Claude model to fully
  saturate** this evaluation."

Only the hallucination half survives, and only narrowly (§6.5.1): Opus 5's
"accuracy is 11% higher than Opus 4.8, but its rate of hallucinations is also 6%
higher". So "hallucinates slightly more despite being more accurate overall" is
**correct**; "confidently asserting answers it was internally unsure about" is
**not supported by §6.5**.

**The claim is real but lives elsewhere — §6.2.1 (Reports from pilot use →
Informal reports)**, which is qualitative pilot feedback, not training monitoring.
Internal pilot users reported:

> Overconfident and unsupported claims, sometimes from model-fabricated data,
> often followed by theatrical retractions

> Self-correction loops where the model continually attempted to reconsider its
> answer, especially at higher effort levels. This also included continually
> re-verifying already verified answers

and external users additionally noticed:

> Doing less than was asked, e.g., by under-investigating requests or not fully
> completing instructions.

§6.1.3 adds that Anthropic's own reviewer model judged the assessment "understated
quantified internal measurements of the model making confident claims and later
retracting them, a pattern that internal measurements on pilot traffic suggested
was elevated", and that Opus 5 "can relay claims from subagents to users without
verifying them".

**Consequences for this plan:**

- The `plot-deliver` change is **kept**, with its rationale rewritten. It is no
  longer "the model is overconfident" (§6.5 refutes that as a trend) but the
  durable architectural argument: *a gate satisfied by self-report is not a gate,
  regardless of which model runs it.* That argument survives a model update; a
  benchmark delta does not.
- §6.2.1's "self-correction loops … continually re-verifying already verified
  answers, **especially at higher effort levels**" is the single most load-bearing
  citation in this plan, because `ralph-sprint.sh:259` runs `--effort high`. It is
  also a better citation for `challenge-the-plan` than §6.5 is.
- The §6.1.3 subagent-relay note directly implicates `ralph-plot-sprint` Step 4,
  which already had to add a rule about subagent findings being lost in return
  text. That existing rule is now externally corroborated.

### Not verified

- **"Anthropic's training monitoring found repeated cases."** Not located. The
  closest support is §6.2.1 (informal pilot feedback) and §6.1.3 (a reviewer
  model's judgement about pilot-traffic measurements). Neither is "training
  monitoring". Do not cite it as such.
- No §2.2.6 claim about "17 unranked outputs" being *ranked* by the comparison
  model in a *general* design task — the ranking claim is specific to protein
  binder designs.

### Second source: context-engineering post

`https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models`
(Anthropic, same day as the system card). Read after the first draft of this plan;
it changed Changes 1 and 2 and added Change 0.

**Supports, quoted:**

- **Constraints belong in the tool surface.** The Todo tool example: listing status
  "as an enumeration between pending, in_progress, and completed, hints to Claude
  about how to use it." Guidance is to "put instructions on how to use tools in the
  tool descriptions rather than the system prompt."
- **Rubrics and verifier agents.** Rubrics are "another form of references" that
  "allow Claude to try and verify your taste in a particular field", used via
  "dynamic workflows" and "spinning up verifier agents with those rubrics."
- **Deletion is safe.** Anthropic "removed over 80% of Claude Code's system prompt"
  for newer models "with no measurable loss on our coding evaluations." The comment
  rule moved from "default to writing no comments. Never write multi-paragraph
  docstrings" to "write code that reads like the surrounding code."

**Does NOT support — stated plainly:** the post contains **no guidance on budgets,
deadlines, max iterations, heartbeats, or long-horizon runs.** Change 1's wall
clock and stall limit rest on §2.2.6 alone. The post changes only *how* those
bounds are expressed (config surface, not prose) — not *whether* they are
justified. Do not cite this post as evidence for the budget itself.

### Read for this plan

`ralph-plot-sprint/SKILL.md`, `ralph-plot-sprint/ralph-sprint.sh`,
`challenge-the-plan/SKILL.md`, `plot-deliver/SKILL.md`, `plot-reconcile/SKILL.md`,
`plot-approve/SKILL.md`, `tracer-bullets/SKILL.md`, `plot/MANIFESTO.md`,
`plot/intro-to-using-plot.md`, `plot/scripts/plot-config.sh`, `.plot/templates/plan.md`.
System card §2.2.6, §6.1.3, §6.2.1, §6.5 in full.

**Not read:** `plot-idea`, `plot-release`, `plot-sprint`, `story-tracking`,
`plot/SKILL.md` (hub), `packages/board`, the helper scripts other than
`plot-config.sh`. All are out of scope. The board-impact assessment above is
therefore reasoned from the plan-format contract, not from reading board source.

## Design

### Approach

Four changes carry weight; three are small. Each is scoped to the smallest edit
that makes the failure mode detectable.

The governing constraint is Manifesto Principle 5 (project-agnostic): every budget
and interval is a `## Plot Config` key with a documented default, resolved through
the existing `plot-config.sh get` accessor. None is hardcoded into a skill.

Precedence for every new key: **environment variable → `## Plot Config` → documented
default.** The env var wins because `ralph-sprint.sh` is invoked by humans and CI
who need per-run overrides without editing a committed file; config wins over the
default because that is the whole point of Principle 5.

Two further constraints, added after reading Anthropic's context-engineering
companion post (see [Second Source](#second-source-context-engineering-post)):
**express constraints in the config surface rather than in prose**, and **the plan
must delete more prose than it adds**.

### Change 0 — Deletion pass (do this first)

The companion post reports Anthropic "removed over 80% of Claude Code's system
prompt" for Claude 5 models "with no measurable loss on our coding evaluations",
and replaced prescriptive style rules with judgement-based ones — "default to
writing no comments. Never write multi-paragraph docstrings" became "write code
that reads like the surrounding code".

Plot's skills carry the same kind of ballast: rules that encode taste, enumerate
what the model can enumerate itself, or restate a decision the surrounding text
already makes. **This section ships before any other change**, so the additions
land in a smaller file rather than a larger one.

| Delete | Where | Words | Why it can go |
|--------|-------|-------|---------------|
| **39 canned question templates** | `challenge-the-plan` → `## Question Templates` | 404 | A list of pre-written questions ("What if user clicks [button] twice rapidly?") is exactly what the material-vs-marginal filter replaces. The filter states the *test*; the model generates the questions. Keeping both means the templates pull toward asking the marginal ones because they are already written. |
| **Tone / Audience / Complexity adaptation blocks** | `challenge-the-plan` → end of Phase 3 | 99 | "Neutral for information gathering, Skeptical for assumptions, Socratic for trade-offs" is taste. Opus 5 modulates register without being told, and a model that cannot will not be rescued by three bullets. |
| **Narrative Weaving example transformation** | `challenge-the-plan` → Phase 5 | 129 | A 129-word before/after JWT example demonstrating "add detail, not sections". The four principles above it already say this. The example is a worked demonstration of a point that needs no demonstration. |
| **Adaptive Depth Strategy** | `challenge-the-plan` | 102 | "Detailed answers: continue at current depth. Terse answers: ask Socratic follow-ups." Read-the-room instructions. Superseded by the stopping rule, which is checkable where this is not. |
| **Step 5 model-tier blockquote** | `plot-deliver` | 109 | Restates the `## Model Guidance` table twelve lines above it, in prose, for one step. Keep the table; drop the restatement. |
| **Common Mistakes rows that restate an adjacent rule** | `ralph-plot-sprint` | ~120 | The table has grown to 17 rows. Rows whose Prevention column merely repeats a CRITICAL rule stated verbatim in the step above it are noise. Keep rows describing a *non-obvious* failure; drop the echoes. |

**Deletion total as implemented: 1,616 words.** Net across the touched files:
**12,389 → 12,356 (−33).** The target is met, though narrowly, and it held through
three subsequent rounds of defect fixes.

*(The figure moved six times: −493 estimated → +443 measured → −29 after the
deletion pass → +4 when the defect fixes added prose → −33 after trimming it →
−33 held through three further rounds of fixes. Every step was measured, and both
upward moves were caught only because someone re-ran `wc -w` instead of trusting
the last number written down. **Final: −33.**)*

| File | Δ |
|------|---|
| `challenge-the-plan` | **−242** |
| `ralph-plot-sprint` SKILL | **−146** |
| `plot-approve` | −21 |
| `plot-deliver` | −4 |
| `plot-reconcile` | +29 |
| `MANIFESTO.md` | +110 |
| `deliverable-rubric.md` (new) | +241 |
| **Total** | **−33** (final; −29 at the time of the deletion pass) |

*Per-file figures re-measured after the defect fixes. Two rows had drifted —
`ralph-plot-sprint` from −138 to −146 and the rubric from +237 to +241 — and they
offset exactly, so the −33 total stayed correct while the breakdown beneath it was
wrong. A summary that reconciles is not evidence that its components do.*

**This took three passes, and the first two were wrong.** The initial estimate
claimed −493 without measuring. The first measurement showed **+443**, and the
plan then argued the target was unreachable without sacrificing load-bearing
procedure. That argument was itself wrong: it treated the whole of
`ralph-plot-sprint` as untouchable while its `## Common Mistakes` table still held
**nine rows restating rules already stated in the step that governs them** — the
clearest possible instance of what this deletion pass is for. Removing them, plus
compressing the plan's own additions in `plot-approve`, `plot-reconcile`, the
Manifesto and the rubric, closed the gap.

The lesson generalises past this plan: *"further cuts would damage the file"* is
the kind of claim that feels like judgement and is actually an untested assertion.
It cost two passes because nobody checked it against the file — including the
agent that wrote it. Change 3's whole argument, applied to Change 0.

**What was NOT cut, and why:** Step 0's orient block (777 w) is state-gathering
and step selection — the file's actual work. Four Common Mistakes rows survive
because their cause is genuinely not obvious from the governing step. Cutting
either to buy more headroom would trade working instructions for a metric.

**The enum contract was executed, not just written.** Running the runner's real
config-resolution prologue against a probe repo whose `## Plot Config` sets
`Sprint deadline: 4h`, `Sprint max iterations: 7`, and a deliberately invalid
`Sprint on budget exhausted: bogus_value`:

```
deadline=4h (14400 s)
max_iter=7
enum=ship_partial
stderr: warning: Sprint on budget exhausted='bogus_value' is not ship_partial|fail; using ship_partial
```

Config values resolve, the duration parses, and the invalid enum coerces to
`ship_partial` with a warning — failing toward shipping, as specified. This is the
difference the plan argues for throughout: a config surface can be *executed* to
prove it behaves as documented, where a paragraph can only be read.

Verify with:

```bash
wc -w skills/{ralph-plot-sprint,challenge-the-plan,plot-deliver,plot-reconcile,plot-approve}/SKILL.md \
      skills/ralph-plot-sprint/deliverable-rubric.md skills/plot/MANIFESTO.md
```

This is a floor, not a target. Reviewers should delete more if they see it — the
listed items are the ones defensible without a judgement call, not the complete
set. Two candidates were considered and **rejected**: `ralph-plot-sprint` Step 0's
orient block (856 words) is load-bearing state-gathering, not taste; and
`plot-reconcile`'s "What you must NOT do" is a safety boundary, which is precisely
what should stay explicit.

**Which token count is being reduced — stated plainly, because this plan's own
word count went up.** The six skill files this plan touches total **12,389 words on
main**. After Change 0's deletions (−963) and Changes 1–7's additions (~470), they
total **~11,896 — a net −493**. That is the number that matters: skills are loaded
into an agent's context on every invocation, so they *are* the prompt.

This plan file grew from 7,246 to ~8,400 words in the same amendment. It is a
design document read once by a human reviewer, not a prompt — it is never loaded
as agent context, and the growth is source verification and rationale that a
reviewer needs in order to disagree with the reasoning. Conflating the two counts
would be the easy way to claim a win here; they are different artifacts with
different readers. **Verify the claim that matters with:**

```bash
wc -w skills/{ralph-plot-sprint,challenge-the-plan,plot-deliver,plot-reconcile,plot-approve}/SKILL.md skills/plot/MANIFESTO.md
```

### Change 1 — `ralph-plot-sprint`: bound the loop (highest priority)

`ralph-sprint.sh` already has an iteration budget (`ITERATIONS`, positional) and a
per-iteration timeout (`RALPH_SPRINT_TIMEOUT`, 1800s). It does **not** have a
declarative budget surface, a verifiable deliverable rubric, an early ship-partial, or a heartbeat.
Three specific gaps map onto the campaign failure:

1. **`ralph-sprint.sh:300-303`** — an iteration that emits *no* signal logs
   `WARNING … Continuing anyway`. Silence is treated as continuation. This is the
   "went silent for its final 8 hours" shape, in code, today.
2. **`ralph-sprint.sh:307`** — the exhaustion notification fires *after* all
   iterations are spent. That is the "shipped nothing" ending: the human learns at
   the end, with nothing banked.
3. **The `<promise>CONTINUE</promise>` signal is self-asserted.** Nothing checks
   that the iteration changed anything. An agent looping on verification emits
   CONTINUE indefinitely and the loop believes it.

#### 1a. Config keys

**The config surface is the specification.** Per the companion post, an
enumeration communicates intended behaviour more reliably than a paragraph — and
unlike a paragraph, a script can check it. The Setup block of
`ralph-plot-sprint/SKILL.md` and the repo's own `CLAUDE.md`:

```
- **Sprint max iterations:** 20
- **Sprint deadline:** 8h
- **Sprint heartbeat interval:** 5m
- **Sprint on budget exhausted:** ship_partial
```

| Key | Env override | Type | Default | Meaning |
|-----|--------------|------|---------|---------|
| `Sprint max iterations` | `RALPH_SPRINT_MAX_ITERATIONS` | integer, `0`=off | `20` | Iteration ceiling. Overrides the positional argument when set. |
| `Sprint deadline` | `RALPH_SPRINT_DEADLINE` | duration (`30m`/`8h`/secs), `0`=off | `8h` | Whole-run elapsed budget. |
| `Sprint heartbeat interval` | `RALPH_SPRINT_HEARTBEAT_INTERVAL` | duration, `0`=off | `5m` | Max age of `.ralph-state/heartbeat` before an external watchdog should treat the run as hung. |
| `Sprint stall limit` | `RALPH_SPRINT_STALL_LIMIT` | integer, `0`=off | `3` | Consecutive iterations with no verified deliverable before the run stops. |
| `Sprint on budget exhausted` | `RALPH_SPRINT_ON_BUDGET_EXHAUSTED` | **enum: `ship_partial` \| `fail`** | `ship_partial` | What happens when any budget above is reached. |

**The enum is the contract**, and it replaces the prose section this plan
originally proposed:

- **`ship_partial`** — on the final iteration before a budget is reached, the
  runner injects `BUDGET: final`. The agent lands in-flight work (push, mark
  finished PRs ready), writes `.ralph-state/handover.md`, and emits `BLOCKED`.
  Exit 0 — a partial ship is a successful outcome, not an error.
- **`fail`** — the runner stops at the boundary, writes whatever handover exists,
  and exits non-zero. For CI, where a partial result should not read as success.

Unrecognised value → `ship_partial` with a warning on stderr. Failing toward
shipping is the safe direction.

`ralph-sprint.sh` validates the enum at startup and prints the resolved budget
line, so the effective configuration is visible in the log before any iteration
runs — no reading of prose required to know what the run will do.

Defaults are **deliberately loose**: run length varies by sprint, and a bound that
fires during normal operation trains the user to raise it. `3` for the stall limit
is the load-bearing number, since a loose deadline rarely fires.

#### 1b. Deliverable checkpoint — rubric plus verifier, not self-assessment

The plan originally proposed a `## Iteration Deliverable Checkpoint` section
instructing the agent to report `deliverable: <what it did>` and to answer
honestly when it had produced nothing. **That was self-assessment of completion,
which §6.5 and §6.2.1 identify as a weak point** — and it contradicted this plan's
own Change 3, which argues a gate satisfied by self-report is not a gate. Both
prose sections are dropped in favour of a rubric the runner evaluates and a
verifier agent that adjudicates the ambiguous cases.

**The rubric** ships as `skills/ralph-plot-sprint/deliverable-rubric.md`. It is
data, not instruction — the runner reads it, and a verifier agent is spun up with
it (the companion post's "spinning up verifier agents with those rubrics"):

```markdown
# Iteration Deliverable Rubric

An iteration PASSES if at least one criterion holds. Each is checkable from
git or forge state without asking the agent what it did.

| # | Criterion | Check | Cost |
|---|-----------|-------|------|
| 1 | Main branch advanced | `git rev-parse origin/<main>` changed | local |
| 2 | A branch was pushed or updated | `git ls-remote --heads origin` diff | local |
| 3 | A PR changed state | `gh pr list --json number,state,isDraft` diff | 1 call |
| 4 | Review comments posted | PR comment count increased | 1 call |
| 5 | A review thread resolved | `isResolved` flipped true | 1 call |

FAIL if none hold. Criteria 1-2 are evaluated every iteration. Criteria 3-5 are
evaluated only when 1-2 fail, so the common case costs no network at all.

NOT deliverables, regardless of how the iteration describes itself: reading code,
analysing state, re-verifying already-verified work, planning the next step,
or confirming that something is already correct.
```

**The verifier** runs only when criteria 1–2 fail — the case where the cheap
local signal says "stall" but a legitimate review-only iteration may have
occurred. It is a subagent given the rubric, the iteration's forge diff, and one
question: *does any criterion hold?* It returns `pass` or `fail` with the
criterion number. It is not asked whether progress was made, and it never sees the
agent's own account of the iteration.

This resolves the blind spot the plan previously accepted (review-only iterations
counting as stalls) without a per-iteration forge query in the common path, and
without asking the working agent to grade itself.

**Handover** — on any budget boundary, `.ralph-state/handover.md` is overwritten
with: what merged, what is in flight and its branch state, what was next and why it
did not happen, and the single next action for a human. Ship-partial fires *before*
the budget is reached, not after.

#### 1d. Runner changes — `ralph-sprint.sh`

| Concern | Change |
|---------|--------|
| Budget resolution | Read all five keys at startup via `plot-config.sh`, env var first. Validate `Sprint on budget exhausted` against the enum; unrecognised → `ship_partial` + stderr warning. Print the resolved budget line before iteration 1. |
| Deadline | `RUN_START=$(date +%s)` before the loop; each iteration, if `elapsed + RALPH_SPRINT_TIMEOUT >= deadline`, inject `BUDGET: final`. Reserving one timeout is what makes ship-partial fire *before* the boundary. |
| Deliverable | Evaluate rubric criteria 1–2 locally (SHA + branch refs). If both fail, spawn the verifier with the rubric to check 3–5. Verifier `fail` → increment stall counter; any pass → reset to 0. |
| Missing signal | Change `:300-303` from WARNING-and-continue to a rubric evaluation like any other iteration. An iteration that emitted nothing is judged on what it changed, not on what it said. |
| Heartbeat | Write `.ralph-state/heartbeat` (+ `.ts`) after each iteration: timestamp, iteration, rubric result, stall counter. `Sprint heartbeat interval` is the staleness threshold an external watchdog compares against. |
| Exhaustion | Behaviour comes from the enum, not from the script: `ship_partial` → handover + `BLOCKED` + exit 0; `fail` → handover + exit non-zero. |

Nothing new is installed; `plot-config.sh` already exits 0 on missing config and
returns the default.

**Why the verifier, and why only on the stall boundary.** The cheap local check
(criteria 1–2) cannot see review-comment-only or thread-resolution iterations,
which are legitimate work that produces no commit. Querying the forge every
iteration to catch them would cost a network call per iteration and introduce a
third state — a failed read is neither "changed" nor "unchanged". Running the
verifier *only when the local check fails* gets the coverage without the cost:
the common path stays local and cannot flake, and the ambiguous path gets a
judgement made against a rubric rather than against the agent's self-report.

**Do not** expand this into general state-diffing. That would be the §2.2.6
failure reproduced inside the fix.

### Change 2 — `challenge-the-plan`: bound the interview

Phase 6 currently exits when "All categories covered comprehensively AND no more
gaps detected in plan AND all open questions have been answered". **"No gaps
detected" is not falsifiable** — an interviewer that over-weights marginal edge
cases will always find another gap. Combined with five categories × four questions
per round and the "Adaptive Deepening" instruction, there is no upper bound on
interview length.

#### 2a. Config key

```
- **Challenge question budget:** 16
```

| Key | Default | Meaning |
|-----|---------|---------|
| `Challenge question budget` | `16` | Maximum questions (4 rounds × 4) before the interview must stop and write up. `0` disables the bound. |

Sixteen is one question per category-progression stage plus a round of slack. A
plan needing more than sixteen questions to reach a decision is a plan that needs
rewriting, not more interviewing.

#### 2b. Exact replacement for Phase 6

Replace the current `### Phase 6: Completion Check` in full with:

```markdown
### Phase 6: Completion Check

Read the budget once at start:
`../plot/scripts/plot-config.sh get "Challenge question budget" 16`

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
```

#### 2c. Exact text to add — the material-vs-marginal filter

New subsection at the end of `### Phase 3: Question Generation`:

```markdown
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
```

**Rationale.** §2.2.6 poor calibration of task scope — the model "tends to
over-engineer and over-emphasize the importance of marginal changes that do not
impact the overall quality". An adaptive interview across four dimensions, driven
by that tendency, is a scope-explosion vector at the phase where scope is cheapest
to explode.

### Change 3 — `plot-deliver`: gates verifiable from state, not from claims

The audit finding is that `plot-deliver` is **already mostly correct**, and Step 7b
is a model of what a gate should be — it names itself "a gate, not a rule", defines
an objective condition, and requires pasting real output. Steps 4, 4b and 7 are
mechanical `gh`/`git` checks. Only Step 5 is soft, and there the softness is
partly by design: it ends in a human confirmation, which per the Manifesto is the
correct final authority.

The genuine weakness is **Step 5 sub-step 2**, which delegates diff review to
parallel subagents and consolidates their returned text into Done/Partial/Missing
— with no requirement that any subagent cite the evidence it is asserting. §6.1.3
notes Opus 5 "can relay claims from subagents to users without verifying them",
and `ralph-plot-sprint` Step 4 already had to add a rule for exactly this failure
in the review path. The delivery path has the same hole and no such rule.

#### 3a. Exact replacement for Step 5, sub-steps 2 and 3

```markdown
2. **Gather PR evidence using parallel subagents.** Launch one Task agent per
   merged PR to review what was implemented:
   - Each agent receives the PR number and the full list of deliverables.
   - Each agent runs `gh pr diff <number>` and reads the PR body via
     `gh pr view <number> --json title,body,files`.
   - Each agent returns, for each deliverable it claims is addressed, a
     **file path and a one-line description of the change at that path**. A
     deliverable asserted without a file path is not evidence and does not count.
   - Launch all PR agents in parallel since they are independent.

3. **Consolidate results.** Merge the per-PR reports into a single checklist. Mark
   each deliverable using the evidence returned, not the subagent's conclusion:
   - **Done** — at least one cited file path, in a merged PR, plausibly implements it
   - **Partial** — cited paths address some of the deliverable
   - **Missing** — no cited path, *or* a claim with no path attached

   A subagent asserting "deliverable 3 is implemented" with no file path is
   **Missing**, not Done. Relaying an unverified subagent claim as a delivery gate
   is the failure this step exists to prevent. If a subagent's citation looks
   wrong, check it with `gh pr diff <number>` before marking the deliverable.
```

#### 3b. Exact text to add to Step 4

Appended to `### 4. Verify All PRs Merged`, after the existing bullet list:

```markdown
**Every branch state in this step comes from `gh`/`git` output, never from
recollection or from a claim made earlier in the session that a PR was merged.**
Re-query if you did not run the command in this step. A PR you merged ten minutes
ago is still queried, not remembered.
```

**Rationale.** §6.1.3 (unverified subagent relay) and §6.2.1 (confident claims
later retracted). Deliberately *not* §6.5 — §6.5.3/§6.5.4/§6.5.5 report Opus 5 at
or above previous models, so this change is not justified by a benchmark trend.
It is justified structurally: a gate whose condition is an agent's own assertion
is not a gate at any model quality. That argument outlives the model version.

**Not changed, deliberately:** Step 5's closing human confirmation stays. Manifesto
Principle 9 and the Pacing section both place final judgement with the human, and
the small-model path already degrades to exactly that. Replacing it with an
automated check would be over-engineering — the §2.2.6 failure mode, applied to
this plan.

### Change 4 — `plot-reconcile`: read-only as an invariant

The skill is already read-only and says so in four places (frontmatter, the intro
paragraph, "What you must NOT do", and the Output section). What is missing is that
all four describe *what it does*, not *what it must not become*. "It is read-only"
is a fact about the present tense; a future edit adding "and fix the safe ones
automatically" would contradict no stated rule.

Minimal change — replace the `## What you must NOT do` first bullet:

```markdown
- **Read-only is a design invariant, not a current behaviour.** This command
  never mutates repository state — not symlinks, not phase fields, not branches —
  and no future version may add that capability. It reports and prints commands;
  the human runs them. A reconcile pass that repairs what it finds cannot be
  trusted to report accurately on what it repaired, and its output stops being an
  independent check. If automatic repair is ever wanted, it belongs in a separate
  command with its own name, so that "run the sweep" never becomes ambiguous
  about whether the repo changed.
```

**Rationale.** Independence. `plot-deliver` Step 7b uses this scan as its
delivery-landed gate; a scan that can also fix things is a gate reporting on its
own work. This is the same argument as Change 3, applied one level up. Cheap to
state, and it removes the ambiguity permanently.

### Change 5 — `plot-approve`: promote tracer bullets to the default recommendation

Step 2b currently "strongly suggests" a tracer under two heuristics (unfamiliar
technology; 3+ branches with core-plus-extras decomposition) and otherwise
"proceeds silently". Silent is the wrong default for the two conditions this plan
is about: a thin vertical slice forces an early deliverable, which is the direct
antidote to both self-verification loops (§2.2.6 — there is something concrete to
finish) and silent abandonment (§2.2.6 — the slice either integrates or visibly
does not).

#### 5a. Exact replacement for the heuristics block in Step 2b

```markdown
- **If no `### Tracer` subsection:** apply the recommendation heuristics. A tracer
  is the **default recommendation** when either condition holds:
  - **Technical uncertainty** — the `## Design` section describes unfamiliar
    technology, an experimental approach, a pattern with no established docs or
    prior art in this codebase, or an integration not previously proven here.
  - **Long horizon** — the plan has 3+ branches, or describes work that will not
    produce anything merged for several working sessions.

  When either holds, recommend rather than merely suggest: "This plan has
  <technical uncertainty | a long horizon>. A tracer bullet — one thin vertical
  slice through every layer — would produce something integrated and merged early
  instead of after the whole plan. Add a `### Tracer` subsection, or proceed
  without one?"

  Proceeding without a tracer stays a single answer away. This is a recommendation
  with a stated reason, never a gate — the human decides, and a plan that does not
  need one should not be slowed down.

  If neither condition holds: proceed silently.
```

**Rationale.** Unchanged mechanics; the shift is from "suggest" to "default
recommendation" with the reason stated, and the long-horizon trigger broadened from
"3+ branches AND core-plus-extras decomposition" to "3+ branches OR multi-session
work". §2.2.6's failing arms had no early deliverable to anchor them; the arm that
shipped something shipped it partway through.

### Change 6 — `MANIFESTO.md`: one new principle

Two candidates were considered. **One is load-bearing; one is not.**

**Proposed — Principle 10, appended after "Small models welcome":**

```markdown
### 10. An agent that has gone quiet has failed, not finished

Unattended agent work must produce an observable trace — a commit, a pushed branch,
a PR state change, a posted comment. Silence is a failure signal, never a
completion signal. Any Plot command that runs unattended must bound how long it may
run, and must ship partial work with a handover before that bound is reached rather
than after.

This is the agentic case of Principle 1. Git is the database; work that never
reached git did not happen, no matter how the agent narrates it. A run that ends
with nothing committed and no explanation is indistinguishable from a run that
never started — and must be treated as the failure it is.
```

**Rejected — "evidence over assertion".** The manifesto covers it. Principle 1
("If it's not in git, it doesn't exist") is the strongest possible form of the
claim, and Principle 3 already draws the interpret-vs-collect line that makes
mechanical checks authoritative. Adding a principle that restates Principle 1 in
weaker words would make the manifesto longer and no sharper — question 5 of the
8-question checklist ("would removing it make the system simpler without losing
something essential?") answers *yes, remove it*. Changes 3 and 4 cite Principle 1
directly instead.

Principle 10 passes the same checklist: git-native (1), no project assumptions (2),
degrades to a warning (3), a convention rather than enforcement (4), not derivable
from an existing principle (5 — Principle 1 says work must reach git, but nothing
currently says an agent must stop and hand over), executable by hand (6 — a human
checks `git log`), small-model-checkable (7), and about deliverables rather than
effort (8).

### Change 7 — Docs: record the model class the skills were tuned against

Skills are prompts; prompts are model-dependent; a model update is a silent
breaking change to the plugin. Nothing in the repo currently records what the
skills were written against.

Two small additions, no new file:

**7a — `skills/plot/intro-to-using-plot.md`**, new section before "Sprints (optional)":

```markdown
## Skills are prompts, and prompts are model-dependent

Plot's commands are markdown instructions interpreted by an AI agent, not scripts
with fixed semantics. The same instruction can be followed differently by a
different model — so a model upgrade can change Plot's behaviour without any commit
to this repo.

Each skill's `## Model Guidance` table states the *minimum* tier a step needs. This
is a floor, not a target: a step marked Small works on Small and above. What the
table does not record is which model the wording was actually tuned against, which
is what changes when a provider ships an update.

That is recorded in `docs/model-provenance.md`. When Plot behaves differently after
a model update, read it first — the skill text may not have changed at all.
```

**7b — new `docs/model-provenance.md`:**

```markdown
# Model Provenance

Which model class Plot's skills were authored and tuned against. Skills are
prompts; a model update can change behaviour with no commit to this repo. This
file makes that dependency visible.

## Current

| Period | Model class | Notes |
|--------|-------------|-------|
| 2026-02 → 2026-07 | Claude Opus 4.x / Sonnet 4.x (Claude Code) | Original authoring and all documented lifecycle test runs. |
| 2026-07 → | Claude Opus 5 | First model class for which known long-horizon failure modes were explicitly designed against — see `docs/plans/2026-07-25-opus5-longhorizon-hardening.md`. |

## Why this is tracked

A skill that reads clearly to one model class may be followed differently by the
next. Behavioural regressions after a model update are not necessarily regressions
in the skill text. Recording provenance turns "Plot broke" into the answerable
question "did the skill change, or did the model?".

## Updating this file

When Plot's skills are re-tested or re-tuned against a new model class, add a row.
State the class, not the exact snapshot — the point is which generation the wording
assumes, not reproducing an exact build.

Behavioural testing is manual (see `CLAUDE.md` → Testing). A row here means a full
lifecycle walkthrough was run against that model class, not that it is expected to
work.
```

**Uncertainty, recorded:** the 2026-02 → 2026-07 row is inferred from the repo's
own history (CLAUDE.md states Plot originated 2026-02-07 across five Claude Code
sessions) rather than from a record of which model was actually in use. It should
be confirmed by whoever ran those sessions before this file is treated as fact. If
it cannot be confirmed, mark it "unrecorded" rather than guessing — a provenance
file with a plausible-but-unverified row is worse than one with an honest gap.

## Non-Goals

Stated verbatim from the brief, so they do not creep in:

- No changes to the lifecycle itself: `/plot-idea → review → /plot-approve →
  implement → /plot-deliver → /plot-release` stays exactly as it is.
- No new commands and no new skills.
- No changes to `packages/board`, the release process, or `.plot/templates`
  structure.
- No changes to `plot-idea`, `plot-release`, `plot-sprint` or `story-tracking`.
- No git-native-planning philosophy debate. The design is settled.

Additionally, self-imposed for this plan:

- **No new validation tooling, scripts, or harnesses.** Budget resolution and the
  rubric's local criteria reuse `git`, `gh`, and `plot-config.sh`. Building a
  verification framework to catch over-verification would reproduce §2.2.6 inside
  the fix.

  **Amended, with the tension stated:** the verifier agent in Change 1b is a
  subagent invocation, not a harness — no new script, no new dependency, no code to
  maintain. But it is honestly *close* to this line, and the amendment weakened the
  non-goal rather than respecting it outright. Two things keep it on the right side:
  it runs only on the stall boundary (not every iteration, so it cannot become the
  main loop's work), and it reads a rubric rather than implementing logic. If it
  grows past "read the rubric, answer pass/fail", it has become the thing this
  non-goal forbids and should be cut back.
- **No changes to the four phase guardrails.** They are cited as context; tightening
  them is separate work.

## Open Questions

- [x] Is `8h` the right deadline default? **Resolved: keep 8h, loose by design.**
      Run length varies by sprint — some short and attended, some long and
      unattended — so no single default fits, and that is precisely what the config
      key exists for. A loose default that never fires on a short run is the
      correct failure direction: it costs nothing, whereas a tight default that
      interrupts healthy runs trains the user to disable it. Projects with a
      consistent pattern should set `Sprint deadline` in their own Plot Config.
      **Consequence:** because the wall clock will rarely fire, the *heartbeat* and
      *stall counter* carry most of the detection weight in Change 1. Weight
      implementation effort accordingly.
- [x] Should `Sprint deadline` and `Sprint stall limit` be one key or two?
      **Resolved: two.** They detect different failures — a slow grind and a fast
      stall — and with run length varying by sprint, a project may well want a
      generous wall clock alongside a tight stall limit. Collapsing them into one
      "sprint budget" would force those to move together.
- [ ] `docs/model-provenance.md` needs its historical row confirmed rather than
      inferred. See Change 7's uncertainty note.
- [x] Does the heartbeat file need to be gitignored? **Yes — checked during
      planning: `git check-ignore .ralph-state/x` reports it is NOT ignored**, so
      the runner's existing `iter-N.jsonl` logs are already untracked-but-visible.
      Adding a heartbeat file makes this worse. Change 1 must add `.ralph-state/`
      to `.gitignore` on the tracer branch. Noted rather than done: this plan
      makes no edits.

## Branches

<!-- Change 1 is the tracer: it touches the skill, the runner script, and the
     config accessor — every layer this plan spans. Change 0's deletions are NOT a
     seventh branch: they land in files these branches already touch, so a separate
     branch would conflict with #51 and #52. Each branch carries its own deletions,
     and each must show a net word count in its PR body. -->

### Tracer

- `feature/opus5-hardening-ralph-bounds` — Declarative budget surface, deliverable rubric + verifier, and heartbeat for `ralph-plot-sprint` → #57
  Layers: `## Plot Config` → `plot-config.sh` → `ralph-sprint.sh` → `ralph-plot-sprint/SKILL.md` → `deliverable-rubric.md`
  Proves: A budget expressed as config (including an enum) can bound an unattended loop, be observed from outside the run, and ship partial work — with the deliverable judged against a rubric rather than self-reported
  Also lands: `.ralph-state/` in `.gitignore`; Common Mistakes rows that echo an adjacent rule deleted
  Status: **Needs rework** — #49 as pushed implements the pre-amendment prose form

### Implementation

- `feature/opus5-hardening-challenge-budget` — Question budget, material-vs-marginal filter, stopping rule; **deletes** 39 question templates, tone/audience/complexity blocks, narrative-weaving example, Adaptive Depth Strategy (−734 w) → #57
- `feature/opus5-hardening-deliver-gates` — Subagent evidence citation, Step 4 re-query rule; **deletes** Step 5 model-tier blockquote (−109 w) → #57
- `docs/opus5-hardening-invariants` — `plot-reconcile` read-only invariant; `MANIFESTO.md` Principle 10 → #57
- `feature/opus5-hardening-approve-tracer` — Tracer bullets as default recommendation in `plot-approve` Step 2b → #57
- `docs/opus5-hardening-model-provenance` — `docs/model-provenance.md` and the `intro-to-using-plot.md` section → #57

Every branch needs a `.changeset/*.md` with a `bumps: skills:` block. Six branches,
five gated behind one tracer.

**Consolidated into a single PR (#57) at the author's request.** The six branches
were merged into `feature/opus5-longhorizon-hardening` with all commits preserved;
#49 and #51–#56 are closed in favour of it. The per-branch decomposition below
records how the work was built and reviewed, not how it ships.

**The PR body states `words before → after` for every file it touches.** The
per-branch figures are in Change 0's table and were measured, not estimated — the
first estimate (−493) proved wrong by ~936 words, which is exactly why a claim
nobody can check is what Change 3 argues against.

## Backlog — surfaced, deliberately deferred

Not in scope. Recorded so they are not rediscovered, and not silently folded in.

- **Phase guardrails as real gates.** `CLAUDE.md` already names this: the four
  guardrails are prose rules in spoke commands, and the stronger form is a
  PreToolUse hook on `gh pr merge` reading the plan phase. Change 3 makes
  `plot-deliver` gates *verifiable*; it does not make them *enforced*. Separate,
  larger, and touches hooks rather than skills.
- **`ralph-plot-sprint` Step 0 complexity.** Step 0 runs eight state checks plus a
  nine-branch step-selection cascade before any work happens — plausibly its own
  instance of §2.2.6, on the orient path. Simplifying it is a behaviour change to
  the step-selection logic and needs its own lifecycle test.
- **Plan files carrying executable acceptance criteria.** A plan's `## Design`
  section states intent in prose, and `/plot-deliver` Step 5 reconstructs whether
  that intent was met by reading diffs. A plan could instead carry a failing test
  suite or a rubric as its acceptance criteria — the same shift Change 1 makes for
  the iteration checkpoint, applied one level up to the plan itself. Delivery would
  then be "the suite passes" rather than "a frontier model judged the diffs
  sufficient". **Deliberately out of scope here**: it changes the plan format,
  which this plan's non-goals exclude and which `packages/board` consumes. Needs
  its own plan.
- **`ralph-sprint.sh` exits on the ntfy env check before printing usage.** Running
  it with no arguments reports `CLAUDE_NTFY_URL: Set CLAUDE_NTFY_URL` instead of
  the usage block, because the `:?` expansion at the top of the config section runs
  before argument validation. **Pre-existing on `main`** (verified against
  `origin/main` — same behaviour, same relative order); this plan neither caused
  nor fixed it. A one-line move of the usage block above the env checks would fix
  it, but that is argument-handling UX, unrelated to bounding the loop.
- **Cost budget alongside the deadline.** The system card campaign had a $10,000
  budget as well as 24 hours. A token/cost ceiling is the natural sibling of
  `Sprint deadline`, but there is no cost signal available to the runner today.
- **`--effort high` as a config key.** `ralph-sprint.sh:259` hardcodes
  `--effort high`, and §6.2.1 reports self-correction loops are worse "especially
  at higher effort levels" and that external users saw "overthinking, where it
  performs worse at higher effort levels". Making effort configurable — or
  lowering it — is plausibly higher-leverage than everything in Change 1. It is
  deferred because it is a one-line change with an unmeasured effect, and shipping
  it alongside four other loop changes would make attribution impossible. **Worth
  a dedicated experiment.** *Deferral confirmed during plan review: the attribution
  argument was tested against making it a fourth config key now, and holds — if the
  sprint improves after Change 1 ships, an effort change bundled with it would make
  the cause unknowable. Run it as a controlled comparison instead.*
- **Applying the material-vs-marginal filter to `/pr-review-toolkit:review-pr`.**
  `ralph-plot-sprint` Step 4 instructs "be specific and harsh"; the same
  over-weighting of marginal findings applies to code review. Out of scope — that
  skill is not in this repo.

## Notes

### On the bounded `challenge-the-plan` run (dogfooding observation)

Step 4 of the brief called for `challenge-the-plan` against this draft, bounded to
12 questions, and asked whether the bound helped or hurt.

**What happened:** the bound was not reached, and that is the observation. Applying
the Change 2 material-vs-marginal filter to this plan while writing it, most
candidate questions failed the test — *if the answer were the opposite, would the
plan change?* The interrogation that shaped this plan was **source verification**,
not interviewing: reading §2.2.6 and §6.5 is what changed the plan's shape,
demoting finding 4 and rewriting Change 3's rationale. No interview question would
have surfaced that, because the plan's weak point was a factual premise, not an
undecided design choice.

Four questions survived the filter and are recorded as Open Questions rather than
answered — the 8h default, the one-key-or-two split, the provenance row, and the
gitignore check. Three of the four are **empirically resolvable** (measure past
runs; check the file) and asking a human to guess would have produced a worse
answer than measuring will.

**Did the bound help or hurt?** It helped, in a way that is worth being precise
about: it did not truncate the interview, it **redirected effort**. Faced with a
budget, the first question became "what is the highest-value thing to spend it on"
— and the honest answer was verifying the premises, not probing the design. An
unbounded run would very likely have produced twelve-plus well-formed questions
about the design of Change 1 (which format for the heartbeat file? should stall
detection use PR state or commit SHA? what if the handover is stale?) and would
have felt more thorough while leaving the inverted finding-4 premise intact. That
is §2.2.6's over-emphasis on marginal changes, described precisely.

**Honest caveat:** this is n=1, self-assessed, on a plan authored by the same agent
applying the bound — the weakest possible evidence, and precisely the kind of
self-report Change 3 argues should not satisfy a gate. It is recorded as an
observation, not a result. The real test is whether Change 2 helps on a plan whose
author *wants* to keep asking questions.

**Second run, with a human answering (partially retracts the above).** The plan was
challenged again, bounded to 12 questions, this time with a human responding rather
than the author self-assessing. Four questions were asked; four were answered; the
budget was again not reached.

The material-vs-marginal filter did the work it claims to. Candidate questions
about heartbeat file format, `handover.md` structure, and notification wording all
failed the *"if the answer were the opposite, would the plan change?"* test and were
not asked. The four that passed all targeted Change 1's stall detection — the only
part of this plan with asymmetric failure costs, since a wrong text edit is caught
free in PR review while a wrong detector either false-positives into being disabled
or never fires at all.

**Result: three answers confirmed the plan; one changed it materially.** Stall
detection moved from git-SHA-plus-forge-state to **git SHA only**, which deleted
the plan's largest recorded uncertainty (the unknown-vs-no-change state machine)
and forced an honest accounting of what the runner can no longer see — now written
into both the runner table and the checkpoint section. The wall-clock and
one-key-or-two questions resolved to "keep, for a stated reason", which is a real
outcome: two Open Questions closed with rationale rather than left hanging.

**What this corrects in the first observation.** The first run concluded the bound
"redirected effort toward verifying premises rather than probing design". That was
true of that run but is too strong as a general claim — with a human answering,
the bound *did* produce design interrogation, and one of four answers changed the
plan's implementation. A 25% shape-change rate on filtered questions is a
reasonable yield. The honest summary is narrower than the first: **the filter
raises the hit rate per question; the bound stops the tail.** Neither run reached
12, which is itself weak evidence that 12–16 is set generously rather than tightly
— an under-binding budget is the safe direction, but it means neither run actually
tested the stopping rule.

Still n=2, still on the same plan, still self-reported. Change 2's real test remains
a plan whose author wants to keep going.

### Amendment — context-engineering post (2026-07-25, after approval)

The plan was approved and its six branches implemented before Anthropic's
context-engineering companion post was read. Three changes followed, applied to
the plan and requiring rework on the already-open PRs:

1. **Change 1 moved from prose to config surface.** The budget was two keys plus
   two prose sections describing what happens at the boundary. It is now five keys,
   one of them an enum (`ship_partial | fail`) that *is* the behavioural contract.
   An enum is checkable at startup; a paragraph is not.
2. **Change 1b moved from self-report to rubric plus verifier.** The original
   `## Iteration Deliverable Checkpoint` instructed the agent to report
   `deliverable: <what it did>` and to be honest when it had produced nothing.
   That was self-assessment of completion — the thing §6.5 and §6.2.1 flag — and it
   **contradicted this plan's own Change 3**, which argues a self-reported gate is
   not a gate. A rubric file plus a verifier agent on the stall boundary replaces
   both prose sections and closes the review-only blind spot the plan had accepted.
3. **Change 0 added: a deletion pass, shipping first.** Net prose across the
   touched skills must go *down*. The post reports 80% of Claude Code's system
   prompt removed with no eval loss; Plot's skills carry the same ballast.

**Honest accounting of the second source:** the post supports items 1–3 directly
and is quoted for each in [Second Source](#second-source-context-engineering-post).
It contains **nothing** about budgets, deadlines, iteration caps, or heartbeats.
The justification for bounding the loop at all remains §2.2.6 alone. The post
changed *how* the bound is expressed, not *whether* it is warranted — and this
distinction is the reason to read sources rather than pattern-match them.

**Cost of the amendment:** PR #49 ships the old prose form and needs rework;
#51 and #52 need the deletion pass folded in. That rework is the price of having
implemented before reading the second source — recorded here rather than smoothed
over, since the tracer existing to surface exactly this kind of problem is the
argument for tracers.

### Verification pass (independent-ish, iteration 6)

An independent reviewer subagent was dispatched to check the three amendment
requirements against the files rather than against the author's summaries. Its
notification had not arrived by the time this section was written, and the task
list showed nothing, so the checks below were run directly instead.

**Correction (iteration 9): the agent had not died.** Its completion notification
arrived several turns later, carrying a full report. See the next section — the
"silent death" reading was wrong, and it is retracted rather than left standing as
convenient evidence for Principle 10.

The direct checks, run while waiting:

| Check | Result |
|-------|--------|
| Enum wired to behaviour, not decorative | `ralph-sprint.sh:461,475` — both exit paths branch on it |
| Any remaining self-assessment instruction | None. The one `deliverable:` string is the *runner* printing its own verdict (`:403,406` — set from the SHA comparison; the agent never supplies it) |
| Net word count | `main=12389 branch=12356` → **−33**, recomputed from `origin/main` |
| Dangling refs to deleted sections | 0 for all five removed headings |
| Five original non-goals verbatim | 5/5 present |
| Stall counter boundary | `-ge` at the top (warn) / `-gt` at the bottom (stop) is deliberate: at limit 3 the agent is told `stalled` and gets one iteration to hand over; the hard stop is at 4. Ship-partial fires before the stop, as designed. |
| Changeset bumps | All 7 parse; all 6 named skills resolve; `plot` appears twice (minor+patch) and resolves to minor |

The reviewer's silence is worth more than its report would have been: it is a live
instance of the failure mode, caught by the discipline this plan is trying to
install. Recorded rather than retried, because a second attempt would prove
nothing about the first.

### Independent verification: requirements sound, seven defects found and fixed

Two independent reviewers checked the branch. **Both completed and reported** —
an earlier draft of this section recorded them as having "died silently" and cited
that as a live instance of Principle 10. That was wrong: their notifications
arrived several turns after the work finished, and latency was mistaken for death,
twice, then written into the plan as supporting evidence. Retracted. Reaching for
the dramatic reading of ambiguous evidence, and finding it confirmed the principle
being written, is itself the §6.2.1 pattern.

**All three amendment requirements: SOUND**, verified against files and commands:

| Requirement | Evidence cited |
|-------------|----------------|
| 1 — budget in config surface | Enum validated at `ralph-sprint.sh:74-78`, wired to real `exit 0`/`exit 1` at two paths — "not decorative" |
| 2 — rubric + verifier | `DELIVERABLE` computed purely from git state, never from agent output |
| 3 — net word count | Independently recomputed: `12360` vs `12389` → **−29, exact match** at review time (**−33** after the defect fixes below) |

`challenge-the-plan` was read in full post-cut: coherent, no dangling references.

**Seven defects found, all fixed.** Four by the first two reviewers, two by a
third review of the *fixes*, and one by a fourth pass over the *fixes to the
fixes*. Each round of repair introduced or exposed the next defect — which is the
most useful single finding in this plan:

| # | Defect | Consequence | Fix |
|---|--------|-------------|-----|
| 1 | `parse_duration "1.5h"` | Fatal arithmetic error; `set -e` aborts the sprint at startup | Validate the numeric part before any arithmetic |
| 2 | `parse_duration "-5m"` / `"bogus"` | Negative budget forcing `final` from iteration 1; non-numeric into integer comparison | Same fix — anything non-numeric → `0` (disabled) |
| 3 | **Deadline was a rule, not a gate** | `BUDGET: final` is a *request*. An agent that keeps emitting `CONTINUE` runs past the deadline indefinitely — the exact failure this budget exists to prevent | Hard stop at the deadline regardless of what the agent emits, honouring the `on_budget_exhausted` enum |
| 4 | **Rubric criterion 2 was promised but never implemented** | The runner checked only main's SHA. A Step 3 iteration that pushes a feature branch — the *most common* productive shape — counted as a stall; three would kill a healthy run | Implement `branch_refs()` via `git ls-remote`; an unreadable remote compares equal and does not count as a deliverable |

| 5 | `main_sha` leaked to stdout | `git rev-parse <bad-ref>` echoes the unresolved ref to **stdout** before failing, so the `\|\| echo unknown` fallback appended to it and the result never equalled `"unknown"`. A *transient* resolution failure would then differ from the previous SHA and score as `main-advanced` — fabricating a deliverable out of a network blip, defeating the guard written to prevent exactly that | `--verify --quiet` |
| 6 | `branch_refs` returned empty, not `unknown` | In `cmd \| sort`, the pipeline's exit status is `sort`'s, which succeeds even when `ls-remote` fails — so the `\|\|` never fired and a failed lookup returned empty. Empty differs from the previous listing, so a blip read as "every branch vanished" and scored as a deliverable | Capture before sorting; return `unknown` on failure |

| 7 | Guard checked only the "after" value | `unknown → <real value>` scored as progress: the remote was unreachable at iteration start and reachable at the end, so a value "appeared" without anything being pushed. An unknown baseline is not a baseline | Require both sides readable before comparing |

Defects 5 and 6 are the same bug in two disguises, and both live in the guard
clauses written to stop an unreadable remote counting as progress. **The guards
were dead code.** They were added deliberately, commented as load-bearing, and
neither worked — because shell failure semantics differ from what the code assumed
in two distinct ways (stdout-on-failure, and pipeline exit status). Nothing in
eleven iterations of testing caught them, because every test ran against a *working*
remote.

**One reported finding was rejected after checking it.** The fourth review flagged
`branch_refs` returning `""` rather than `"unknown"` for a reachable remote with
zero branches (MEDIUM, "latent, not currently exploitable"). Traced through the
consumer: empty is a *truthful* state — zero branches — where `unknown` means the
lookup failed. Collapsing them would make the first push into a fresh repo
undetectable, turning a non-bug into a real one. Documented in the code as
deliberate; the reviewer's own verdict was APPROVE.

Recording this because the corrective pattern runs both ways: six findings were
accepted and fixed, one was checked and declined. A reviewer's report is evidence,
not instruction — the same standard this plan applies to an agent's self-report.

Defects 3 and 4 are the serious ones, and both are the same species of error:
**the plan wrote down a mechanism and the implementation delivered less than the
prose claimed.** Defect 3 shipped a signal where a gate was described — the
distinction `CLAUDE.md` explicitly warns about ("a rule is a guideline the agent
can rationalise around"). Defect 4 shipped a rubric listing five criteria where
one was checked.

Neither was caught by nine iterations of author self-verification. Both were found
by readers who compared the prose against the code rather than against their memory
of writing it. That is the plan's own thesis holding up under test — and the
uncomfortable half of it: **the author was the least reliable checker of his own
gates**, which is precisely why Change 3 argues a gate must not be satisfied by
the claim of the thing being gated.

### Working constraints observed for this session

- Exploration was time-boxed; the plan was written in one pass after reading the
  source and the in-scope skills.
- No tooling, scripts, or harnesses were built for this task.
- Uncertainties were written into the plan (Open Questions, the two "uncertainty,
  recorded" notes) rather than resolved by adding scope.
- What was not read is listed in [Source Verification](#source-verification).
  Two briefed findings did not survive the source and are corrected there rather
  than built upon.

### Definition of Done

`docs/definition-of-done.md`. Board impact: none — see the Changelog comment.
