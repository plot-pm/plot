---
title: The board sees one repository
author: jwloka
status: draft
created: 2026-08-21
updated: 2026-08-21
---

# The board sees one repository

## Objective

A team at ewz ran Plot on a four-repository, fixed-price piece of work and
generated a Story Progress Review from its own Plot artefacts. That report names
five things holding progress. Checked against the code that decides — not the
comments that describe it — **none of the five would the board have shown**, and
four of them for one reason: they live in repositories the board never queries.

This story is about that reason.

## Why Now

First evidence of Plot in someone else's project rather than in its own.
[[plot-board]] — *Making parallel work visible* — asks *"what is everything
waiting for"* from the inside. This report answers it from the outside, and the
answer is that the question was scoped to one repository while the work was not.

## Decisions Taken in Scoping

**Q: Why not fold this into *Making parallel work visible*?**
That story is `active` and argues from this repo's own fleet, which is
single-repo by construction. The cross-repo finding contradicts its frame rather
than extending it, and a contradiction deserves its own file.

**Q: Does the ewz team read the board at all?**
The report shows no board use. Its stated sources are files —
*"Quellen: stories/produktteaser/ — Plan, Story, Sessionlog und
Strukturspezifikation"* — and the board appears nowhere in 267 lines. This is
recorded as a fact about the report, not as an open question: an earlier draft
raised it as *"unknown"* and then ranked four board features anyway, which is
the same mistake twice.

It sets the honest framing: these are gaps in a surface this team may not open.
The cross-repo finding survives that, because a board that cannot see four
repositories is a reason not to open it.

**Q: Do this session's own agentic failures belong here?**
No. On 2026-08-21 this repo hit several — 90 assertions querying a replaced DOM
shape, a test green on macOS and red on CI, four CI runs starving each other.
They are real, they are *not in the ewz report*, and including them would dress
self-observation up as customer evidence.

**Q: What counts as evidence?**
The line that **decides**, not the line that describes. An earlier draft of this
story cited `schema.ts:1333` (a row in a doc-comment table) and `:1342` (an enum
member) as proof that a state fires. Reading `stuck.ts:288-312` and
`plot-fleet-scan.sh:1324-1345` instead reversed two of its five verdicts. This
repo's comments read like specification, which is exactly what makes them a trap.

## Current Plan

### Phase 1: Score the five blockers against the deciding code ✅

- ✅ Read the report — 14 items, 4 repos, 6 open PRs, fixed price
- ✅ Trace each blocker to the detector, not the contract — see Key Findings
- ✅ Independent adversarial review; verdict REJECT on the first draft, which is
  why this file is a re-derivation rather than an edit

### Phase 2: Decide whether Plot wants the repo axis ⏸️

- ⏸️ `repoRoot` is already a parameter, deliberately (`fleet.ts:4574-4576`). Is
  the second repo an addition, as that comment promises, or does the scan's
  plan-enumeration make it a rebuild?
- ⏸️ Where does a multi-repo estate live in the plan format? `Impl: other repo`
  is one field; this report needs four repos in one story.
- ⏸️ Interrogate before coding. Nothing below is approved.

### Phase 3: Plans ⏸️

- ⏸️ One plan for the repo axis, if Phase 2 says yes
- ⏸️ One plan for `requestedReviewers`, which is small and independent

## Open Points

- ⏸️ Four repositories, one story. Is Plot's unit of work the repo or the story?
  The report treats U4 and U5 — the same A11y fix in `ewz-kus-contracts` and
  `ewz-kus-portal` — as one item. Plot has no shape for that.
- ⏸️ Would this team open a board that showed all four repos? Unanswerable from
  the report; needs asking.

## Key Findings

### 2026-08-21 — Four of five blockers are in repositories the board never queries

**Expected:** Gaps would be per-feature — a missing state here, a missing field
there.

**Discovered:** One structural gap accounts for most of them. The board polls one
repository:

- `pr-list` runs with `cwd: opts.repoRoot` and no `--repo`
  (`packages/board/src/server/fleet.ts:1532`), although `plot-host.sh` accepts
  `--repo` on `pr-state` (`:234`) — the adapter can be asked; the board does not
  ask.
- `buildFleet` reduces the estate to a scalar: `const repo =
  path.basename(opts.repoRoot)` (`fleet.ts:4579`).
- It is deliberate and documented as provisional: *"repoRoot stays a parameter
  even while the UI shows one repo, so the second one is an addition rather than
  a rebuild"* (`fleet.ts:4574-4576`).

The report's estate is **4 repositories** with 6 open PRs: #3775/#3776 in
`ewz-webportal`, #516 in `ewz-webportal-components`, #936 in
`ewz-kus-contracts`, #3553 in `ewz-kus-portal`. **A board run in any one of them
sees at most one of the six.**

**Impact:** This outranks every per-feature gap, and it invalidates the way the
first draft scored them — each cell was judged as though one board could observe
this estate. It cannot. A dependency between two rows is worth modelling only
once both rows can exist.

### 2026-08-21 — A never-pushed branch has no row, so no detector runs

**Expected:** `unpushed` would cover the report's P2 — *"durchgeführt, aber
nirgends sichtbar … auf einem lokalen Branch, ungepusht und ohne PR"*. Its
contract reads *"commits exist that only this machine can see"*.

**Discovered:** Two independent reasons it does not, and the weaker one is the
one an earlier draft recorded.

1. **No row exists.** Rows come from plan waves only: `plot-fleet-scan.sh:2594`
   iterates a wave's branches, parsed from `## Branches` by
   `plot-plan-meta.sh:441`; `fleet.ts:4005-4058` walks `pulse.plans → waves →
   branches`. Nothing manufactures a row from a local branch. The report's P2 has
   no wave, no PR, no claim.
2. **The detector could not fire anyway.** `local_ahead_of`
   (`plot-fleet-scan.sh:1324-1345`) counts
   `refs/remotes/origin/<b>..refs/heads/<b>` and prints `0` when there is no
   remote ref — *"Not observed → not reported"*. `stuck.ts:310-312` gates on
   `if (localAhead > 0)`, so `unpushed` means *pushed, then advanced locally*
   (`stuck.ts:24` names it: *"the #177 case"*), never *never pushed*.

**Impact:** Reason 1 holds even if reason 2 were fixed, which makes it the
finding. The board's phrase for this — *not observed → not reported* — is the
same statement the report writes as *"nirgends sichtbar"*.

### 2026-08-21 — The reviewer blocker needs a field nobody fetches

**Expected:** Either the board shows reviewers or the host adapter cannot ask.

**Discovered:** Neither. `reviewDecision` is fetched (`plot-host.sh:439`),
projected as `review` (`:456`), carried (`schema.ts:64`), typed *"informational
only"* (`fleet.ts:195`) and rendered by `reviewNote()` (`fleet.ts:3359-3366`) —
so the path works. But `reviewDecision` reports an **outcome**, and cannot
separate *"a reviewer is assigned and has not reviewed"* from *"nobody is
assigned"*: both are `REVIEW_REQUIRED`.

Prior art already measured its worth: `docs/plans/2026-08-15-agent-view-completion.md:129`
found it **empty on all twelve** sampled PRs, and `:380` records that a note
built on it *"read as precise and was noise"*. Empty falls to `reviewNote`'s
default arm and returns `''`. So the realistic behaviour is a row saying
**nothing** about review — not a row wrongly saying *"awaiting review"*, which an
earlier draft claimed and which would also have required rows this estate does
not produce.

**Impact:** The answering field is `requestedReviewers` — who is assigned rather
than how it ended — and it appears nowhere in `skills/` or
`packages/board/src`. Naming it turns a complaint into a change. It rides the
same GraphQL response the query already pays for, which is the standard
`plot-host.sh:437` sets for itself: *"Free: same GraphQL response, same call, no
extra request."*

### 2026-08-21 — The remaining two blockers have no representation at all

**Discovered:** Nothing under `packages/board/src` represents either.

- **A requirement deliberately left unmet.** Contrast 1.55:1 (sun) and 2.36:1
  (wind) against 3:1 required; *"Der Audit-Befund #28 hat kein Ticket, das
  WCAG-Programm ist geschlossen … Entscheid: sie bleiben"*. Decided, closed,
  waiting on nobody. Plot's four phases (Draft → Approved → Delivered →
  Released) have no place for it, so it stays open forever or vanishes quietly.
- **A blocker outside the team.** X1 waits on ewz/OIZ with *"Termin
  unbestimmt"*. The board has WAITING ON YOU and WAITING ON A MACHINE; there is
  no *waiting on someone else*, and no addressee on a wait.

**Impact:** These two are genuinely absent rather than mis-scored, and they are
the only two where the first draft's verdict survived review.

### 2026-08-21 — Rejected: "the gaps are one missing relation"

**Expected (by the first draft):** All the gaps were dependency statements —
*this waits on that* — so one relation would answer them.

**Discovered:** It holds for two. The rotten-build chain (#3776 → #3775) is a
real edge; X1 → U3 is an edge, though X1's own content is a missing *attribute*
(an external addressee). But *five PRs without a reviewer* is a property of one
PR, whose own remedy is a field passthrough; and the contrast finding is
emphatically not waiting on anything.

**Impact:** The tidy sentence was the defect this repo keeps removing, committed
two lines after citing the file that names it: *"Stuck as a single word is the
one-label-many-states defect this board keeps removing"*
(`schema.ts:1325-1327`). Four different shapes were forced under one label
because the label read well.

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| This session's own agentic failures | Self-observed, absent from the report | They recur in a customer project and reach a report like this |
| The contrast values themselves | ewz's design decision, already taken | Never — this is about representing the decision |
| The ewz work itself (four repos, field contract, Option D) | Not our estate | — |
| A board section per wait kind | Sections are the board's scarcest space | The wait kinds collapse to one section with an addressee |
| "One missing relation" as a frame | Refuted above; holds for 2 of 4 | — |
| A pattern of "mechanisms fetched and never used" | Had one real member. `tupleFromBuild` is a **fixed** defect (`tuple-row.ts:506` dates it 2026-08-20, pinned at `test/unit/tuple-row.test.ts:706`), and `reviewDecision` was a false reading | Two live members are found |

## Progress Tracking

| Repo/Area | PR | Ticket | Status | Notes |
|-----------|----|----|--------|-------|
| Report analysis | — | — | ✅ Done | Five blockers traced to detectors; adversarial review passed on the second derivation |
| Repo axis | — | — | ⏸️ Candidate | Largest gap. `fleet.ts:1532`, `:4579`; promised as "an addition" at `:4574-4576` |
| `requestedReviewers` | — | — | ⏸️ Candidate | Not fetched anywhere; shares an existing round trip |
| Deliberately unmet requirement | — | — | ⏸️ Candidate | Touches the four-phase model |
| Wait with an addressee | — | — | ⏸️ Candidate | Needs Phase 2: section, plan field, or both |

## Session Log

### 2026-08-21 — Reading the report, then being wrong about it twice

The report is a Plot artefact reporting on Plot-managed work, which is what
makes it evidence rather than anecdote. ~6 KB of substance in a 1.3 MB export.

**Key outcomes:**

- None of the five blockers is a board signal today
- Four of them are in repositories the board never queries — one gap larger than
  the four per-feature candidates combined
- `requestedReviewers`, not `reviewDecision`, answers the reviewer blocker
- The report shows no board use at all, which frames every ranking above

**What the first draft got wrong, and why.** It scored one blocker as covered
and one as half-covered, and asserted a Key Finding that a field was fetched and
discarded. All three came from **one habit: citing doc-comments instead of
detectors.** `schema.ts:1333` is prose and `:1342` is an enum member; the
behaviour lives in `stuck.ts:288-312` and `plot-fleet-scan.sh:1324`. A separate
error had the same root: searching for `reviewDecision` under the board found
nothing because the field is renamed to `review` one line below the line that
was cited — a grep for the wrong side of a rename cannot help but read as proof.

An independent review returned REJECT rather than REVISE, on the ground that
with no "Yes" left the title inverted. Correct — hence this file is a
re-derivation. It also supplied the two findings the first draft should have led
with: `requestedReviewers`, and the repo axis.

**Corrected earlier in the session:** a first look reported "no stories and no
story tooling in this repo". A persistent `cd` had left the shell in
`packages/board/src`; three stories and the full skill were present.
