# plot-2 eval scoreboard

Run log for the suites in `promptfoo/` (results JSON gitignored; this
file is the committed record). Flake policy: a single flake on rerun is
noise; a repeated one is drift.

## 2026-07-31 — baseline + first fix round (pre-merge, v2.0 chain)

**Baseline** (first full run, 4 providers, ~35 tests / 138 calls,
75k–~180k tokens total):

| Suite | Result | Reading |
|---|---|---|
| approve | 12/12 | ballot stop names the missing reviewer; same-branch no-merge holds |
| sprint-gate | 12/12 | tracker decline + proceed cases clean |
| staleness | 12/12 | clean/drift verdicts + action escalation clean |
| story-triage | 20/20 | synthetic umbrella-rule verdicts clean |
| ceremony | 18/24 | fails = harness realism, not skill: missing `/plot-idea slug: title` invocations made gpt route-out; asserts rejected the skill's own human wording (`same branch`) that the product parser accepts; gemini reasoning overflow |
| orientation | 0/6 | infrastructure: llm-rubric grader fell back to ambient Google Vertex credentials — fixed with an explicit OpenRouter grading provider |
| activation | 3/6 | half infrastructure (same grader issue); one REAL finding, see below |

**Real defects found and fixed (the point of running pre-merge):**

1. **story-tracking over-triggered "story" on coordination** — models ruled
   story via "multi-ticket coordination" where a discovery package / rich
   ticket + linked plans was the umbrella (the calibration suite in the
   dev workspace caught it, 3 of 4 providers). Fix: the overflow signal
   now says *check what already exists first*; a cross-artifact status
   table is the board's job. Plus the tracker-less negative-rule analog
   (bounded slice = plan even without a ticket).
2. **hub skill lacked an activation guard** — installed-but-not-invoked
   haiku injected branch/PR ceremony into a trivial rename (activation
   suite, rubric-confirmed). Fix: explicit activation guard in the hub
   skill: trivial asks get helped directly, ceremony scales with weight.

**Harness fixes:** real invocations in ceremony scenarios; impl-answer
asserts accept the product parser's normalization inputs (`same branch`
etc.); explicit rubric grading provider (OpenRouter sonnet); "Do not
explain" in one-line grammars; gemini budget raised (one-line suites
only — excluded from prose suites per the established precedent).

**Confirmation rerun: BLOCKED** — the OpenRouter key hit its weekly
limit mid-rerun (partial valid results: activation 5/6 with the grader
fixed — the remaining fail is finding 2, fixed after; approve 10/10
valid calls). Rerun all suites when the key limit resets; expected
green except possible fresh findings.
