# A plan greps for its own deliverable

> Five plans this week proposed something the estate already had, and one argued through two interrogation rounds about a gate that had already moved. Every one was caught by grepping; none by reading. `/plot-idea` already detects a duplicate plan and does not detect a duplicate deliverable.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-06, Jan Wloka, in-session
- **Rounds:** 1
- **Started:** 2026-09-06, Jan Wloka, `feature/a-plan-names-its-deliverable`
- **Started:** 2026-09-07, Jan Wloka, `feature/the-idea-searches-the-estate`

## Changelog

- A plan names what it builds, and `/plot-idea` searches the estate for it before the plan is written.

<!-- Board impact: none. The check runs at plan creation and writes nothing the
     board reads. -->

## Motivation

**Measured 2026-09-06, over one week of planning on this repo:**

| plan proposed | the estate already had |
|---|---|
| normalize version strings at the parser | `entities/version.ts:25`, `normalizeVersion`, **10 callers** |
| a grep gate for `gh` callers | `scripts/check-host-cli-callers.sh`, shipped 2026-09-05 |
| a multi-branch-slice finding | `plot-reconcile-scan.sh` **section 7**, with a reslice hint |
| a delta over two pulses | `rules/pulse.ts`, `readingLoss`, called from `fleet.ts:1126` |
| a story status-versus-plans warning | `board.ts:1416`, `computeStatusDrift` |

**Five, plus a sixth of a different shape:** `the-last-two-callers-ask-the-adapter` spent **two interrogation rounds** debating where a merge gate should live and how its three answers map to two. Both had been settled by #706, in the file the plan is about, with the reasoning in its header.

**EVERY ONE WAS FOUND BY A GREP AND NONE BY A ROUND.** Reading the plan again produces better prose about the same assumption; searching the estate produces the answer. Two of the five were caught only because the plans were checked against the domain before approval rather than after.

**`/plot-idea` ALREADY DOES THIS FOR PLANS.** Step 3's *Duplicate detection* searches the plan directory rather than the index, and says why: *"A gate a missing symlink can bypass is a rule … The plan directory holds every plan by construction, so a collision cannot hide from it."*

**The same argument applies one level down.** A plan that duplicates another plan is caught. A plan that duplicates a **function, a script or a scan section** is not, and five did.

## What this is not

**Not a prose reminder.** CLAUDE.md's own test — *can you answer "did I complete this?" without doing the work?* — is answered **yes** by "the author should grep first". That is a rule, and five plans violated it in one week.

**Not a refusal.** A plan may legitimately propose replacing something that exists — `every-pr-question-goes-through-the-adapter` did exactly that. The check reports what it found and the author decides; a hard gate would refuse every migration.

**Not automatic.** The plan names its deliverable; nothing infers it. A search over a plan's prose would match every symbol it cites, and a plan citing `readingLoss` to say *"unlike readingLoss"* is not duplicating it.

## Slices

### A plan says what it builds (Branch: feature/a-plan-names-its-deliverable, PR: #744)

The plan template carries a `Builds:` field naming the artifact each slice creates, and `plot-plan-meta.sh` parses it.

**IT IS THE SLICE'S FIELD, NOT THE PLAN'S.** A plan builds several things and each slice builds one; a plan-level list would be searched as a whole and reported against the wrong slice.

**OPTIONAL, LIKE `Sprint:` AND `Story:`.** A plan that builds nothing nameable — a docs plan, a rejection, a measurement — writes nothing and is not nagged. The check runs on what is declared.

**A 28TH FIELD IS A REAL COST AND IT IS PAID BY ONE CONSUMER.** `plot-plan-meta.sh` reports 27 fields today, and each is a thing a reader must handle and a thing that can go stale. `Builds:` is read by `/plot-idea` alone, written by the plans that have something to declare, and absent everywhere else — which is exactly `Sprint:`'s and `Story:`'s shape, and neither of those has cost the estate anything.

**The alternative was parsing the Done-when**, which every slice already has. Rejected: a Done-when is prose written for a reader, and a check that parses it either misses deliverables phrased unusually or matches words that are not deliverables. A declared field says what the author meant.

**THE PARSER IS THE CONTRACT AND GAINS ONE FIELD.** `plot-plan-meta.sh` already reports `sprint`, `story`, `review`, `impl` and the transition records; `builds` joins them. `test/reconcile/` holds the format tests and gains one.

**Done when** a slice can name what it builds, the parser reports it, and a plan without one parses exactly as it does today.

### Adoption searches for it (Branch: feature/the-idea-searches-the-estate, PR: #755)

`/plot-idea` step 3 searches the estate for each declared deliverable and reports what it finds.

**IT EXTENDS THE STEP THAT EXISTS.** *Duplicate detection* already runs there for plan slugs, with a stated reason for searching the directory rather than the index. A deliverable search is the same act against a different corpus.

**WHAT IT SEARCHES IS NAMED, NOT GUESSED.** `packages/*/src`, `skills/plot/scripts`, `scripts/` and the reconcile scan's section headings — the four places the five misses were hiding. A search over the whole tree would match documentation and comments, and a check that fires on prose is one an author learns to skip.

**AND IT SEARCHES THE CONCEPT, NOT ONLY THE NAME.** Measured 2026-09-06: all five duplications are found by a plain grep **once the name is known** — `normalizeVersion` in 4 files, `readingLoss` in 2, `computeStatusDrift` in 1. That is not the hard case.

**The hard case is the one that beat a careful searcher.** `check-host-cli-callers.sh` was missed by a search for `check-*gh*`, because the plan said *gh* and the estate says *host CLI*. **A name-based search only works when the author already guesses the estate's vocabulary** — and an author proposing a thing is precisely the person who does not know what it is called.

**So a slice declares its deliverable and the check expands it.** `gh` also searches `host` and `host-cli`; a rule name also searches its bare noun. The output is candidates a person dismisses, not a verdict — which is the same posture as *Duplicate detection*'s title-similarity check one level up, and the reason this reports rather than refuses.

**IT REPORTS AND NEVER REFUSES.** The output names the file and line so the author can say *"yes, I am replacing that"* — which two of the five plans legitimately were.

**Done when** a plan declaring a deliverable that exists gets its file and line before the plan is written, a plan declaring a new one gets silence, and nothing is refused.

## Notes

### Why the check is at creation rather than at approval — 2026-09-06

Approval is where a plan is read most carefully, and reading is exactly what missed all five. The cost of a duplicated deliverable is paid in the writing — the plan's prose, its rounds, its brief — so the check belongs before that work, not after it.

**Two of the five were caught at approval this week**, which is the argument for the check rather than against it: they were caught because somebody grepped, and the other three were not.
