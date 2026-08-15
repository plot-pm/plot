# Release closes the loop

> The fourth phase has never been reached. `/plot-release` ships versions but
> never tells the plans they shipped.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-release` records the release in the plans it contains: each delivered
  plan gains `Phase: Released` and a `Released:` transition record naming the
  version, and its index symlink is already where it belongs.
- `plot-reconcile-scan.sh` reports delivered plans whose work is inside a
  released tag but which are still marked Delivered — the drift that made this
  invisible for sixteen releases.

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
must not look the same. The footer gains a counter so the sweep stays
machine-countable.

**Historical plans are back-filled where git can answer.** Six plans are
currently Delivered. Five resolve exactly through their PR annotations —
v1.0.0, v1.7.0, v2.1.0, v2.2.0, and one that is genuinely in no release yet.
The sixth (`reconcile-drift-loop`) carries no PR annotation and stays Delivered,
reported by the scan.

That asymmetry is the point rather than an inconvenience: the plans the method
can answer for get an exact record, and the one it cannot gets a visible gap
instead of a plausible fiction.

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
- [ ] Do docs/infra plans get a `Released:` record at all? They are live when
      merged, and `/plot-deliver` already tells them so. Marking them Released
      may be inventing a phase they do not have.

## Branches

### Write

- `feature/release-marks-plans` — `/plot-release` writes Phase + `Released:` per included plan, idempotently

### Check

- `bug/scan-unreleased-delivered` — reconcile section for delivered-but-shipped plans, plus the footer counter

<!-- Two waves, one branch each: both edit the plot skill estate, and the
     check is written second so it can be verified against a repo the write
     has already corrected. -->

The two are serialised deliberately. The check's value is that it finds what the
write misses, and testing it against a repo the write has already cleaned is the
only way to see it report zero honestly rather than by accident.

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

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "How is a plan's release version determined?", "a": "git tag --contains on the merge SHA — dates are wrong for the majority of real cases", "category": "technical"},
    {"q": "plot-plan-meta.sh has no released_raw — how far does the parser change go?", "a": "Add released_raw alongside the other transition records, with a contract fixture", "category": "technical"},
    {"q": "Back-fill the six existing delivered plans?", "a": "Yes where git tag --contains answers (five); the sixth stays Delivered and is reported", "category": "domain"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

Definition of Done: `docs/definition-of-done.md`.
