# Harden Plot against documented Opus 5 long-horizon failure modes

> Bound the automated sprint runner and the plan-interrogation interview, make delivery gates mechanically verifiable, and record which model class the skills were tuned against.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Story:** plot-gates

## Approval

- **Approved:** 2026-07-25T13:13:51Z
- **Approved by:** jwloka
- **Assignee:** jwloka

## Changelog

- `ralph-plot-sprint` gains a wall-clock budget, a per-iteration deliverable checkpoint, a ship-partial fallback that fires before the budget expires, and a heartbeat so prolonged silence is detectable as an error state.
- `challenge-the-plan` gains a question budget, a material-vs-marginal filter, and a falsifiable stopping rule.
- `plot-deliver` gate language tightened so every gate is verifiable from git/forge state rather than from the agent's own claim of completion.
- `plot-reconcile` read-only-ness stated as a design invariant rather than a description of current behaviour.
- New `## Plot Config` keys: `Sprint wall clock`, `Sprint stall limit`, `Challenge question budget`. All optional, all with documented defaults.
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

### Change 1 — `ralph-plot-sprint`: bound the loop (highest priority)

`ralph-sprint.sh` already has an iteration budget (`ITERATIONS`, positional) and a
per-iteration timeout (`RALPH_SPRINT_TIMEOUT`, 1800s). It does **not** have a
wall-clock budget, a deliverable checkpoint, an early ship-partial, or a heartbeat.
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

Added to the Setup block of `ralph-plot-sprint/SKILL.md` and to the repo's own
`CLAUDE.md` `## Plot Config`:

```
- **Sprint wall clock:** 8h
- **Sprint stall limit:** 3
```

| Key | Env override | Default | Meaning |
|-----|--------------|---------|---------|
| `Sprint wall clock` | `RALPH_SPRINT_WALL_CLOCK` | `8h` | Total elapsed time for the whole run, across all iterations. Accepts `30m`, `8h`, or bare seconds. `0` disables. |
| `Sprint stall limit` | `RALPH_SPRINT_STALL_LIMIT` | `3` | Consecutive iterations with no observable deliverable before the run is declared stalled. `0` disables. |

Defaults chosen to be **deliberately loose**. Run length varies by sprint — some
short and attended, some long and unattended — so no default fits every case, and
adopting projects with a consistent pattern should set their own. A bound that
fires during normal operation is worse than no bound: it trains the user to raise
it, and a disabled detector has zero coverage.

`3` for the stall limit is the load-bearing number, because the wall clock will
rarely fire under a loose default. Three exceeds the legitimate "posted review
comments, no commit" case, which is one iteration by design (Step 4 posts, Step 1
then fixes and commits).

#### 1b. Deliverable checkpoint — exact text to add to `SKILL.md`

New section, placed immediately before `## Promise Signals`:

```markdown
## Iteration Deliverable Checkpoint

An iteration must leave an **observable trace in git or on the forge**. The
promise signal reports what you did; it is not evidence that you did it. This
section is a gate, not a rule: the checkable condition is that at least one of
the following is true *after* your step, and you can name which one.

| Deliverable | How it is observed |
|-------------|--------------------|
| A commit landed | `git rev-parse origin/<main>` differs from the value at iteration start |
| A branch was pushed | `git ls-remote --heads origin <branch>` returns a new SHA |
| A PR changed state | `gh pr view <n> --json state,isDraft` differs from iteration start |
| A review comment was posted | `gh api repos/<owner>/<repo>/pulls/<n>/comments` count increased |
| A review thread was resolved | The thread's `isResolved` flipped to `true` |

Name the deliverable in your iteration summary, as the artifact — e.g.
`deliverable: pushed feature/sse-backpressure (a1b2c3d)` or
`deliverable: posted 4 review comments on #12`.

**If no deliverable was produced,** say so explicitly:
`deliverable: none — <one-line reason>`. Do not manufacture one, and do not
describe analysis, reading, or verification as a deliverable. Reading the codebase
is not a deliverable. Confirming that existing work is correct is not a
deliverable. An iteration that only re-verifies already-verified work must report
`deliverable: none`.

Consecutive `deliverable: none` iterations are what the runner counts against
`Sprint stall limit`. Reporting a deliverable you did not produce defeats the only
mechanism that can detect a stalled run.

**What the runner independently verifies.** The runner checks one thing: whether
`origin/<main>` moved. Of the deliverables above, only *a commit landed* is
machine-detected. The other four are reported by you and not verified — which is
why naming them accurately matters. The runner cannot catch a false
`deliverable: posted 4 review comments`; a human reading the handover can.

This asymmetry is deliberate, not an oversight. A cheap check that never
misfires is worth more than a thorough one that flakes on a network read.
```

**Rationale.** §2.2.6 — the failing arms "consistently got stuck in
self-verification loops instead of producing designs". A loop cannot detect that
state from its own narration; it needs a fact about the world. §6.2.1's
"continually re-verifying already verified answers, especially at higher effort
levels" is why the exclusion is stated explicitly — and `ralph-sprint.sh:259`
passes `--effort high`.

#### 1c. Ship-partial fallback — exact text to add to `SKILL.md`

New section, immediately after the checkpoint section:

```markdown
## Budget Exhaustion and Ship-Partial

The runner injects `BUDGET: <state>` into the iteration prompt. Three states:

- **`BUDGET: ok`** — proceed normally.
- **`BUDGET: final`** — this is the last iteration before the budget expires. Do
  **not** start new work. Land what is already in flight: push uncommitted work on
  the current branch, mark finished PRs ready, and write the handover (below).
  Then emit `<promise>BLOCKED</promise>`.
- **`BUDGET: stalled`** — `Sprint stall limit` consecutive iterations produced no
  deliverable. Do not attempt the same step again. Write the handover, stating
  what you were attempting and what blocked it, and emit
  `<promise>BLOCKED</promise>`.

**Handover** — write to `.ralph-state/handover.md` (overwrite; it describes the
current stop, not a history) and include:

- What was completed this run: merged PRs, pushed branches, resolved threads.
- What is in flight: branch names and their exact state.
- What was next, and why it did not happen.
- The single next action a human should take.

Ship-partial fires *before* the budget expires, not after. Seventeen partial
results with a handover beat zero results and silence.
```

**Rationale.** §2.2.6: one arm "shipped 17 unranked designs after abandoning the
selectivity goal partway through; the other shipped nothing and went silent". The
17-design arm was the better outcome. This makes partial delivery the *designed*
ending rather than an accident, and makes abandonment explicit rather than silent.

#### 1d. Runner changes — `ralph-sprint.sh`

| Concern | Change |
|---------|--------|
| Wall clock | Record `RUN_START=$(date +%s)` before the loop. Each iteration, compute elapsed; if `elapsed + RALPH_SPRINT_TIMEOUT >= WALL_CLOCK`, inject `BUDGET: final`. The reserve is deliberate — the final iteration must have room to run. |
| Stall detection | Capture `git rev-parse origin/<main>` before the iteration and again after. Unchanged → increment the stall counter; changed → reset to 0. Counter reaching `Sprint stall limit` injects `BUDGET: stalled`. **Git SHA only — no forge query.** See below. |
| Missing signal | **Change `:300-303` from WARNING-and-continue to a stall increment.** An iteration with no parseable signal counts as `deliverable: none` regardless of what else it did. Silence must cost something. |
| Heartbeat | After each iteration, write `.ralph-state/heartbeat` with epoch timestamp, iteration number, deliverable line, and stall counter. Sufficient for `test $(($(date +%s) - $(cat .ralph-state/heartbeat.ts))) -gt 3600` from cron or a watchdog. No new daemon, no new dependency. |
| Notification | On `BLOCKED` via `final`/`stalled`, the existing ntfy call sends the handover's next-action line rather than the generic summary. |

Config read at startup via `plot-config.sh get "Sprint wall clock" 8h`, env var taking
precedence. Nothing new is installed; `plot-config.sh` already exits 0 on missing
config and returns the default.

**Stall detection uses the git SHA alone, and this is a deliberate trade.**

The richer alternative — diffing forge state (open PRs, review threads) across
iterations — detects more kinds of progress, but costs one `gh pr list` per
iteration and introduces a third state: a failed network read is neither "changed"
nor "unchanged". Handling that correctly means distinguishing *unknown* from *no
change* and not counting unknowns, which is machinery whose own failure modes need
testing. `git rev-parse origin/<main>` is local, is already fetched, cannot flake,
and has exactly two outcomes.

The reasoning is the same as Change 3's: **a detector that lies gets switched off,
and a switched-off detector has zero coverage.** A slightly blind detector that
never produces a false alarm stays enabled. Reliability beats coverage for
something whose whole job is to be trusted when it fires.

**The cost, stated plainly.** A git-SHA-only signal cannot see:

- **Step 4 iterations** (post review comments) — no commit, by design.
- **Thread-resolution-only iterations** in Step 1's refinement path.
- **PR state flips** — `gh pr ready` without a push.

A Step 4 iteration therefore counts as a stall even though it did real work. With
`Sprint stall limit: 3` this is safe in the normal cycle, where Step 4 (comments)
is followed by Step 1 (fixes, which commit) — the counter resets on iteration two
of three. **The case that would false-positive is a plan needing three or more
consecutive review rounds with no code change between them.** That is rare and,
arguably, itself worth interrupting a run for.

If that false positive shows up in practice, the fix is to reset the counter when
the iteration reports a `deliverable:` line naming review comments *and* the PR
comment count is checked once — a single targeted query on the stall boundary
rather than every iteration. **Do not** build general state-diffing; that would be
the §2.2.6 failure reproduced inside the fix.

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

- **No new validation tooling, scripts, or harnesses.** The checkpoint and stall
  detection reuse `git`, `gh`, and `plot-config.sh`. Building a verification
  framework to catch over-verification would reproduce §2.2.6 inside the fix.
- **No changes to the four phase guardrails.** They are cited as context; tightening
  them is separate work.

## Open Questions

- [x] Is `8h` the right wall-clock default? **Resolved: keep 8h, loose by design.**
      Run length varies by sprint — some short and attended, some long and
      unattended — so no single default fits, and that is precisely what the config
      key exists for. A loose default that never fires on a short run is the
      correct failure direction: it costs nothing, whereas a tight default that
      interrupts healthy runs trains the user to disable it. Projects with a
      consistent pattern should set `Sprint wall clock` in their own Plot Config.
      **Consequence:** because the wall clock will rarely fire, the *heartbeat* and
      *stall counter* carry most of the detection weight in Change 1. Weight
      implementation effort accordingly.
- [x] Should `Sprint wall clock` and `Sprint stall limit` be one key or two?
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

## Waves

<!-- RECOVERED 2026-08-25. The six branches below were opened on 2026-07-25 and
     their PRs (#49, #51, #52, #53, #54, #55) were closed the same day, each
     with the note "Consolidated into #57 — all commits from this branch are
     preserved there." #57 then sat open for four weeks and fell 1738 commits
     behind main.

     A rebase was rejected: the Juli contributions are 1–11 lines per file
     against 45–218 lines of subsequent work on main, so a rebase would risk
     four weeks of development to land additions that do not conflict at all.
     Measured per conflicted file instead — see below. -->

### Superseded — reached main by other routes

Four of the six changes **already reached main by other routes** in the four
weeks #57 was open. Verified 2026-08-25 by grepping main for each change's own
subject rather than by reading the diff:

- **approve-tracer** — the tracer-bullet recommendation is on main in the
  plot-approve skill, developed further than this branch had it
- **deliver-gates** — the subagent refutation pass is on main in the plot-deliver
  skill, including the *"EXECUTED versus what you only READ"* wording verbatim
- **invariants** — its plot-reconcile change was +1/−1 line and is subsumed by
  main's seven-section scan
- **challenge-budget** — the question-budget shape reached challenge-the-plan
  independently

### Recovered (Branch: infra/recover-opus5-hardening)

The four things measurably still missing from main, taken from #57 onto a fresh
branch cut from current main — no rebase, no conflict:

- the manifesto — **Principle 13**, *An agent that has gone quiet
  has failed, not finished*. Renumbered from 10: main gained two principles
  while #57 waited. Its 2026-08-25 measurement is appended, because the estate
  produced exactly the failure the principle predicted.
- the model-provenance doc — the whole file, absent from main
- the ralph-plot-sprint deliverable rubric — the whole file, absent
- the ignore file — the runner's scratch directory

### Not recovered, deliberately

The ralph-sprint runner script is 156 lines longer on #57 than on
main — the wall-clock budget and ship-partial machinery this plan's tracer was
built to prove. It is **not** in the recovery branch, because it is code rather
than prose and its interaction with four weeks of runner changes was not
measured. It stays on the consolidated branch, which is left on the remote.

**That makes this plan's tracer question still open**, and the honest reading is
that the plan is delivered in its documentation and undelivered in its
mechanism. The plan *a-hung-child-does-not-hold-the-loop* (2026-08-25) now covers the same
ground for the worker loop, measured on a live failure.


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
- **Cost budget alongside wall clock.** The system card campaign had a $10,000
  budget as well as 24 hours. A token/cost ceiling is the natural sibling of
  `Sprint wall clock`, but there is no cost signal available to the runner today.
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
