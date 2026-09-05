# Sprint: Every concept has one owner

> Plot's entities are declared more than once, and the copies disagree. A story's status is declared three times; a plan's phase carries two meanings in one word; the merge question has four shell callers and no domain rule; the build's bundles are marked in one place out of eight. This sprint gives each concept a single owner and deletes the second declaration.

## Status

- **Phase:** Active
- **Start:** 2026-09-05
- **End:** 2026-09-19
- **Release:** 2.14.0

## Sprint Goal

**A concept is declared once, and everything else reads that declaration.**

Measured across the six plans below, on 2026-09-05:

```
                                        declarations   how the drift showed
story status                                 3         a 7th value nothing admits
plan phase / workflow phase                  2         one word, two meanings
"did this land"                              4 callers no domain rule at all
generated bundles marked -merge              1 of 8    markers in shipped JS
processes with a start command               0 of 2    a queue no agent could take
```

**Every one of these was found by a person, not by a gate.** Three stories were marked `done` wrongly while consolidating the estate and caught by a human reading a board warning. Eight conflict markers reached generated JavaScript and were caught by a hand-run rebase. A dispatch queued a slice against `agents=0` and was caught by reading a tick's output.

**The pattern is the same each time:** two readings of one fact, both individually correct, disagreeing because nothing made them the same reading.

## MoSCoW

### Must Have

Stories: [[the-domain-knows-what-plot-knows]], [[the-master-agent-holds-the-fleet]]

- [ ] [a-process-is-started-by-its-own-command] Both long-lived processes get a command that owns them, and an agent can be brought into existence — measured 2026-09-05: a dispatch reported `handed over … started=0` and the supervisor ticked `agents=0 queued=456`, so the chain *dispatch queues → registry matches → an agent takes it* had no last link. **Approved, 5 slices, reordered so the agent starter leads**
- [ ] [a-lifecycle-is-enforced-by-a-test] Each core element's lifecycle becomes a domain rule that refuses illegal transitions, with a test per refusal — measured: **23 entities, 1 transitions file**, and the one that exists carries 41 tests with 24 refusal assertions. **Approved, 5 slices**
- [ ] [the-workflow-owns-the-word-phase] A plan's `state` and a workflow's `phase` stop sharing one word — a delivered plan is ready for testing, and today one field claims both. **Approved, 5 slices**

### Should Have

- [ ] [every-element-is-a-domain-concept] Branch, Plan, Slice and Review get domain types, and the merge question stops being four shell callers — `pr_merged` and `pr_open` are coupled such that neither is safe alone, which is exactly the property a rule can hold and a comment cannot. **Approved, 6 slices**
- [ ] [every-generated-bundle-is-marked] Every bundle `build.mjs` emits is marked `-merge`, and the repair path recognises the set — measured 2026-09-05: `board-server.mjs` took 0 conflict markers and the two unmarked bundles took 8, and `plot-resolve-artifact.sh` then refused the branch as *not artifact-only*. **Draft, 2 slices**

### Could Have

- [ ] [the-board-answers-while-it-scans] The board keeps serving while it scans — it stops for seconds at a time at zero CPU. **Draft**

## Notes

### Why this sprint exists rather than the one it replaces — 2026-09-05

[[2026-W36-a-half-landed-workflow-says-so]] was `Planned`, targeted 2.13.0, and was displaced twice by explicit calls. Measured 2026-09-05: **none of its eight items ever became a plan**, and its release target shipped on 2026-09-05 without it. It stays where it is rather than being rewritten — a sprint whose goal was never worked is a record, and overwriting it would hide that two weeks of intent produced no plans.

**This sprint holds work that exists.** All six items have plan files, four are Approved, and three had agents on them the day it opened.

### The goal is testable, and here is the test — 2026-09-05

**For each concept below, `grep` finds exactly one declaration.** Not "the code is cleaner": a countable claim, the way [[the-sprint-proves-its-own-goal]] made the previous sprint's goal countable with a CI gate that fails when the alias count grows.

Three of the six carry that shape already — the story lifecycle asserts *a status the domain cannot represent is a compile error*, the bundle plan adds a gate deriving the set from `build.mjs`, and the phase plan renames a field every plan file carries.

### Two of these are gates, not rules — 2026-09-05

CLAUDE.md's test is *can you answer "did I complete this?" without doing the work?* Two items answer no by construction: the bundle gate fails CI when `build.mjs` gains an unmarked output, and the lifecycle rules refuse illegal transitions rather than documenting them. The others are rules today and say so.

### Release 2.14.0 — 2026-09-05

2.13.0 shipped 2026-09-05 with `@plot-pm/board@0.11.0`. Nothing in this sprint is in it. The version is a target rather than a promise: `/plot-release` reads the estate, and an item that has not delivered blocks nothing here — it reports.
