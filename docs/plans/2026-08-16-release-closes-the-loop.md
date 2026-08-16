# Release closes the loop

> The fourth phase has never been reached. `/plot-release` ships versions but
> never tells the plans they shipped.

## Status

- **Phase:** Released
- **Delivered:** 2026-08-16
- **Released:** 2026-08-16, v2.3.0
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-16, jwloka, plan-PR #110 merged
- **Started:** 2026-08-16, jwloka, `bug/scan-unreleased-delivered`
- **Started:** 2026-08-16, jwloka, `feature/release-marks-plans`

## Approval

- **Assignee:** jwloka

## Changelog

- `/plot-release` records the release in the plans it contains: each delivered
  feature or bug plan gains `Phase: Released` and a `Released:` transition
  record naming the version, and ends with a gate proving the write landed.
  docs/infra plans are skipped — they are live when merged, and `/plot-deliver`
  already says so.
- `plot-reconcile-scan.sh` reports delivered plans whose work is inside a
  released tag but which are still marked Delivered — the drift that made this
  invisible for sixteen releases. It ships first, because it doubles as the
  gate proving the write above landed, and the six existing plans are
  back-filled with it.

Board impact: **yes — the plan-format contract gains a field.**
`plot-plan-meta.sh` emits `approved_raw` and `started_raw` but no
`released_raw`; adding it changes the contract the board consumes, so its zod
schema and the contract fixtures move with it. The Released *column* already
exists and renders — what changes is that it stops being permanently empty.

## Motivation

The board grew a Released column on 2026-08-16 and it was empty — while
Endgame held five cards, four of which had shipped in v2.2.0 that same day.

Checking rather than assuming turned a display oddity into a structural finding:
**no plan in this repo's history has ever reached `Phase: Released`.** Not one,
across sixteen versioned releases from v1.0.0 to v2.2.0. The fourth phase of the
documented lifecycle is not rarely used; it has never been reached.

`/plot-release` has six steps. Step 4 hands off to the project's own release
process — changesets, CI, tag — and that hand-off is correct: Plot should not
drive someone else's release machinery. But nothing comes back afterwards. The
version ships, the tag lands, the changelog fills, and the plans that describe
that work sit at Delivered forever.

**Why it stayed invisible.** Nothing compared the two facts. The reconcile scan
checks for plans whose branches merged while still Approved, but has no notion
of "delivered work that is inside a release tag". And no human notices an
absence they have never seen filled — the Released column did not exist until
yesterday, so its emptiness had nothing to contradict it.

That is the same shape as two other findings this week: a board update that
never happens looks exactly like a board nobody configured, and a scan that
reports on shapes it recognises is silent about states it does not model.
Silence reads as health.

## Design

### Approach

Two branches: the write, then the check that catches it when the write is
skipped.

**Step 1 — `/plot-release` records the release in the plans.**

After the version exists (step 4's hand-off has completed and a tag is
reachable), each plan included in that release gets:

    - **Phase:** Released
    - **Released:** <YYYY-MM-DD>, <version>

`plot-plan-meta.sh` gains `released_raw` alongside `approved_raw` and
`started_raw` — verified absent today, so this is a parser change the first
draft did not account for. Without it the version is written but unreadable,
and the board would have to re-derive what the record already states. The
plan-format contract test gains a fixture, since that file is where the format
is specified.

**Which version a plan belongs to is answered by git, not by dates.** The first
draft of this plan proposed reusing step 2B's set — delivered plans newer than
the last tag. Checked against the real repo, that is wrong in the majority of
cases:

| Plan | by delivery date | by `git tag --contains` |
|---|---|---|
| `board-sync` | v2.1.0 | **v1.0.0** |
| `kanban-board-v1` | v2.1.0 | **v1.7.0** |
| `fleet-agent-view` | v2.1.0 | **v2.2.0** |

The delivery date is when the plan was *booked*, not when its code merged —
`board-sync` sat five months between the two. And v2.1.0 and v2.2.0 share a tag
date, so day-resolution cannot separate them even in principle.

The exact question is *which release tag contains this plan's merge commit*, and
git answers it directly: resolve each `→ #N` annotation to its merge SHA, then
take the lowest `git tag --contains <sha>` matching the release pattern. A plan
whose merge is in no tag yet gets **no record** — "not released" is a real
answer, and the method reports it rather than rounding up to the nearest
version.

A plan with no PR annotation cannot be resolved this way. It is left at
Delivered and reported by the scan below, which is better than a guess: an
invented version in a transition record is a claim nobody will re-check.

**The write is idempotent and additive.** A plan already at Released is left
alone; a plan already carrying a `Released:` record for that version is not
duplicated. Re-running after a partial failure converges rather than compounds.

**The symlink does not move.** Delivered and Released plans both live in
`delivered/` — that index means "no longer active", not "phase is exactly
Delivered". This is worth stating because the delivery step *does* move the
symlink, and the symmetry invites a move that would be wrong.

**Ordering matters and is not obvious.** The tag must exist before the plans are
marked, or a failed release leaves plans claiming a version that was never cut.
So this runs after the hand-off, and its absence is recoverable: the reconcile
check below finds anything the step missed, which is precisely why the check is
in the same plan rather than a follow-up.

**And it ends with a gate, in the shape `/plot-deliver` step 7b already
established.** This is a multi-file write followed by a push — flip several
phases, add several records, commit, push — which is exactly the operation that
half-lands. 7b exists because delivery had the same shape, and this one is
worse: it touches N plans rather than one, so a partial write leaves some
released and some not, with nothing to say which.

The gate runs the section-2 check and shows its **real output**. An empty result
clears it; anything reported is a hard stop with the fix printed. Not a warning
— a warning nobody reads is silence with more text, and silence is what let this
sit for sixteen releases.

Note the pleasing economy: the check written for section 2 is the gate for
section 1. That is why they belong in one plan, why the check is worth building
even though the write is the visible feature, and why it is built first.

**What the user sees.** The step names every plan it touched and shows the
gate's real output — the same shape `/plot-deliver` uses for its 7b footer,
where an actual scan line is pasted rather than the word "verified":

    Released as v2.3.0:
      fleet-agent-view          docs/plans/2026-08-15-fleet-agent-view.md
      reconcile-scan-accuracy   docs/plans/2026-08-15-reconcile-scan-accuracy.md
    Not marked:
      some-docs-plan            docs plan — live when merged
      older-plan                unresolvable: no PR annotation
    summary: … unreleased_delivered=0 …

Listing what was **not** marked matters more than listing what was. A plan
silently skipped looks identical to a plan that had nothing to do, and this
whole finding exists because those two were indistinguishable for sixteen
releases.

**docs/infra plans end at Delivered.** They are live when merged, and
`/plot-deliver` already tells their authors exactly that — marking them Released
would contradict a message Plot itself sends. The write skips them and the check
skips them too, so they never surface as permanent drift. (Every plan in this
repo today is `feature`, so the rule is currently untested against real docs or
infra work — stated here so it is a decision rather than an oversight.)

**Step 2 — the scan reports the drift.**

A new section: plans at Delivered whose merge commit is already inside a release
tag. Same question as the write, same method — `git tag --contains` on the PR
annotation — so the check and the write cannot disagree about what "released"
means. A check built on a different rule than the write it guards is worse than
no check, because a mismatch reads as drift.

The check is git-only (tags, refs, plan phases), so it costs nothing and works
offline. Each finding names the version it found and prints
`/plot-release`; a plan with no PR annotation is reported as
**unresolvable** rather than skipped, because "cannot tell" and "nothing wrong"
must not look the same. docs/infra plans are excluded by type, so they never
appear as permanent drift. The footer gains a counter so the sweep stays
machine-countable.

This section doubles as step 1's gate, which is the reason it is worth building
even though the write is the visible half.

**Historical plans are back-filled where git can answer — which here is all of
them.** Running the rule as a prototype over the six delivered plans:

    board-sync            → v1.0.0     kanban-board-v1       → v1.7.0
    reconcile-drift-loop  → v1.6.0     parallel-agent-fleet  → v2.1.0
    fleet-agent-view      → v2.2.0     agent-view-completion → in no release yet

Five carry drift; the sixth is correctly unreleased and needs nothing. An
earlier draft of this plan claimed `reconcile-drift-loop` had no PR annotation
and would stay unresolvable — that came from a hand-written list rather than
from the parser, and it is wrong: the annotation is there and resolves cleanly.

The unresolvable case therefore has **no instance in this repo**. The rule stays
in the plan because other repos will have plans predating their PR annotations,
and because an invented version in a transition record is a claim nobody
re-checks. But it is a rule for elsewhere, not a description of the back-fill
here.

**Manifesto check.** Principle 1: the release record lives in the plan file,
where every other transition record lives; the tag remains the git truth and the
record merely reflects it. Principle 3: the scan reports drift, the human (or
`/plot-release`) fixes it. Principle 12: the scan turns an assertion — "releases
close the loop" — into something checkable, which is the whole reason it goes in
alongside the write.

### Open Questions

- [ ] Should marking be part of `/plot-release` or a separate `/plot-released`
      step? Coupling risks a half-run leaving plans unmarked; separating risks
      nobody running it. The scan makes either recoverable, which argues for
      coupling.
- [ ] What version does a plan get when its branches merged either side of a
      tag? `git tag --contains` answers per branch, so the plan has several
      answers and no single one. Taking the **last** branch's version is the
      honest reading — the plan is not fully released until its final branch is
      — but it makes the record depend on branch order rather than on the plan.
- [ ] **A merged-and-deleted branch reads as `open` in the fleet scan.** Seen
      when #111 merged: the wave stayed `eligible` and the next one `blocked`,
      because `branch_state()` resolves state from refs and a deleted ref
      cannot be told from one that never existed. It only surfaces between a
      merge and the plan's delivery — earlier waves never showed it because
      their plans were already Delivered and dropped out of the scan. It is the
      same git-only blind spot as unpushed work being invisible in the Agents
      tab.
      **Amended 2026-08-16, after #124 merged — no longer cosmetic.** The
      original reading ("the wave gate is advisory, not enforced") was sound
      when written and is now false, because the gate acquired an automated
      reader. With both of `board-reads-git`'s PRs merged and both refs
      deleted, `plot-fleet-scan.sh --next` answers
      `bug/board-claimed-from-git` — it *names finished work as the next thing
      to start*, and that is the exact question `plot-dispatch.sh` asks before
      fanning out. A dispatch would build a worktree, push a claim, and set an
      agent on work already sitting on `main`; the claim push would then
      recreate the ref and re-badge the branch `claimed`, so the wrong answer
      manufactures its own evidence. It also explains the deleted ref that had
      to be restored by hand earlier today to unblock a wave — that was the
      symptom; this line is the cause.
      Absence is ambiguous and the script silently picks one meaning: a
      never-created branch and a merged-then-deleted one are the same missing
      ref. Structurally the same defect `bug/scan-contained-in-pr` just fixed
      one `else` over, where "not the head of an open PR" meant *orphan*. The
      merge state is in git either way — `git merge-base --is-ancestor` against
      the merge commits on `main`, or the PR number the plan already records.
- [ ] **Twelve plan-state commits went straight to `main` today**, every one of
      them waved through branch protection by admin rights. The micro-PR
      fallback in `/plot-approve` only triggers on *rejection*, never on a
      bypass — so the fallback has never once fired. This step adds a
      thirteenth such push and inherits the problem rather than causing it. It
      belongs to `/plot-approve`, `/plot-implement` and `/plot-deliver` equally,
      so it wants its own plan; recorded here so it does not sink again.

## Branches

### Check

- `bug/scan-unreleased-delivered` — reconcile section for delivered-but-shipped plans, the footer counter, and the back-fill of the six existing plans → #111

### Write

- `feature/release-marks-plans` — `/plot-release` writes Phase + `Released:` per included plan, idempotently, gated on the check → #112

<!-- Two waves, one branch each, in this order because the write's gate IS
     the check. The first draft had them the other way round, which would
     have shipped the multi-file write ungated. -->

**The check comes first because it is the write's gate.** The first draft
ordered these the other way, reasoning that a check is best tested against a
repo the write has already cleaned. That is true and it is the wrong trade: it
would ship the multi-file write with nothing to prove it landed — precisely the
risk that put a gate in the plan.

Reversed, both halves get better. The check is independently useful the moment
it exists (it reports five real drift cases today, before anything writes), and
the write arrives into a repo where its gate already works. The back-fill rides
with the check for the same reason: the branch that finds the drift is the
branch that clears it, and the repo demonstrates the fix on itself.

## Notes

Found on 2026-08-16 while delivering `agent-view-completion`: the new Released
column rendered empty beside an Endgame column holding five cards, four of them
shipped in v2.2.0 hours earlier. The board did not cause the drift and does not
fix it — it made four months of it visible, which is what a column whose
emptiness is wrong is for.

Interrogated with `/challenge-the-plan` before approval. One finding replaced
the design's core mechanism; two others filled gaps the draft had not seen.

- **The version cannot be derived from dates.** The draft proposed reusing step
  2B's date comparison. Checked against the real repo, it is wrong for the
  majority: `board-sync` → v1.0.0 not v2.1.0, `kanban-board-v1` → v1.7.0 not
  v2.1.0, `fleet-agent-view` → v2.2.0 not v2.1.0. The delivery date records the
  *booking*, and `board-sync` sat five months between merge and booking — while
  v2.1.0 and v2.2.0 share a tag date, so day resolution cannot separate them at
  all. `git tag --contains` on the merge SHA answers exactly, including the
  honest "in no release yet".
- **`plot-plan-meta.sh` has no `released_raw`.** Verified: it emits
  `approved_raw` and `started_raw` only. The draft claimed no contract change
  was needed; there is one, and it carries the board's schema with it.
- **The back-fill is asymmetric on purpose.** Five of the six delivered plans
  resolve exactly; the sixth has no PR annotation and stays Delivered, reported
  by the scan. A visible gap beats a plausible fiction in a record nobody
  re-checks.

Round 3 found a contradiction between two things the plan said, and one claim
that was simply wrong:

- **The waves were ordered backwards.** The plan said the section-2 check is the
  write's gate, then scheduled the write first — shipping the multi-file write
  ungated. Reversed: the check ships first, is useful on its own, and the write
  lands where its gate already works.
- **All six delivered plans resolve**, contradicting round 1's claim that
  `reconcile-drift-loop` had no PR annotation. That came from a hand-written
  list rather than the parser; it resolves to v1.6.0. The prototype run reports
  five drift cases and one correctly-unreleased plan, so the rule works and the
  "unresolvable" branch has no instance here.
- **The step now says what it did not do.** A silently skipped plan looks
  identical to a plan with nothing to do — which is the exact confusion that
  hid this for sixteen releases.

Round 2 went after the write's failure paths and the questions round 1 had only
posed:

- **The write had no gate.** `/plot-deliver` step 7b exists because flipping a
  phase, moving a symlink and pushing is an operation that half-lands. This step
  has the same shape and is worse — it touches N plans, so a partial write
  leaves some released and some not with nothing to say which. It now ends by
  running the section-2 check and showing its real output. The check written for
  the scan *is* the gate for the write, which is the economy that justifies
  building both here.
- **docs/infra plans end at Delivered.** `/plot-deliver` already tells their
  authors no release is needed; marking them Released would contradict a message
  Plot itself sends. Both the write and the check skip them by type.
- **Twelve plan-state commits went straight to `main` today**, every one waved
  through branch protection by admin rights — the micro-PR fallback triggers on
  rejection, never on a bypass, so it has never fired. This step inherits the
  problem rather than causing it, and it belongs to three other commands
  equally, so it is recorded as an open question rather than fixed here.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {"q": "How is a plan's release version determined?", "a": "git tag --contains on the merge SHA — dates are wrong for the majority of real cases", "category": "technical"},
    {"q": "plot-plan-meta.sh has no released_raw — how far does the parser change go?", "a": "Add released_raw alongside the other transition records, with a contract fixture", "category": "technical"},
    {"q": "Back-fill the six existing delivered plans?", "a": "Yes where git tag --contains answers (five); the sixth stays Delivered and is reported", "category": "domain"},
    {"q": "Should the multi-plan write have a gate like /plot-deliver 7b?", "a": "Yes, same shape — run the section-2 check and show its real output", "category": "technical"},
    {"q": "Do docs/infra plans get a Released record?", "a": "No — they end at Delivered, consistent with what /plot-deliver already tells them", "category": "domain"},
    {"q": "Twelve direct pushes to main bypassed branch protection — fix here?", "a": "No — it affects approve/implement/deliver equally; recorded as an open question for its own plan", "category": "tradeOffs"},
    {"q": "Wave 1 needs the gate wave 2 builds — contradiction?", "a": "Swap them: the check ships first, is independently useful, and the write arrives into a repo where its gate works", "category": "technical"},
    {"q": "All six delivered plans resolve, contradicting round 1 — what about the back-fill?", "a": "Back-fill all six in the check branch; the unresolvable rule stays for other repos but has no instance here", "category": "domain"},
    {"q": "What does /plot-release print?", "a": "Every plan touched, every plan NOT marked with the reason, and the gate's real scan line", "category": "ux"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": true, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

Definition of Done: `docs/definition-of-done.md`.

Delivered 2026-08-16, the day it was approved. The evidence is the number the
plan was written around: section 6 reported **5** delivered-but-shipped plans
before the back-fill and **0** after, and the board's Released column — which
had been structurally empty for the repo's entire history — now holds five
cards while Endgame holds one.

Two defects surfaced while building, neither by tests:

- The first working scan reported **v2.2.0 for a plan that shipped in v1.7.0**.
  `pr-state` carried no `mergeCommit`, so a `git log --grep "#N"` fallback
  matched any commit *mentioning* the PR rather than its merge — producing five
  plausible versions of which at least one was wrong. Exactly the "claim nobody
  re-checks" this plan warns about. The adapter now carries the merge SHA and
  the fallback is gone.
- Appending `type` to the parsed plan rows **leaked the field separator** into
  section 2 (`PRs: 1\x1Ffeature`), because one read loop still named seven
  fields: an unread trailing field lands in the last one read. Same class as the
  tab-collapse bugs this suite caught twice, so the new test pins the property
  rather than the fix — no report line may contain the separator, whatever the
  field count becomes.

And one from the merge itself: a **merged-and-deleted branch reads as `open`**
in the fleet scan, because state resolves from refs and a deleted ref cannot be
told from one that never existed. Recorded as an open question — the same
git-only blind spot as unpushed work being invisible in the Agents tab. Judged
cosmetic when written; **amended after #124 merged**, which gave the advisory
wave gate an automated reader: `--next` now names finished work as the next
thing to start, and that is the question `plot-dispatch.sh` asks before fanning
out. See the open question above for the evidence.
