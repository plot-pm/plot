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

Board impact: **none by itself.** No plan-format field is added that
`plot-plan-meta.sh` does not already parse (`released` is an accepted phase
today), and the board's Released column already exists and renders. The change
is that it stops being permanently empty.

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

Which plans are included is already determined in step 2B: delivered plans newer
than the last release tag, the same set the changelog is built from. No new
discovery logic — the step that decides what goes into release notes decides
what gets marked.

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

A new section: delivered plans whose delivery date precedes the newest release
tag but which are not marked Released. That is the exact condition that went
unnoticed sixteen times.

The check is git-only — tag dates and plan phases — so it costs nothing and
works offline. Its finding prints the fix (`/plot-release` for the version in
question, or a manual note for historical plans), and the footer gains a
counter so the sweep stays machine-countable.

**Historical plans are a decision, not a default.** Six plans are currently
Delivered and shipped long ago; three of them predate the tags that contain
them by months. Back-filling `Released:` records for those is honest only if the
version can be determined — which for a plan delivered on 2026-08-15 and shipped
in v2.2.0 is straightforward, and for older ones may not be. The plan proposes
back-filling where the version is unambiguous and leaving the rest to be
reported by the scan rather than guessed at.

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
- [ ] What version does a plan get when its work spans two releases? The
      changelog attributes per PR; a plan whose branches merged either side of a
      tag has no single answer. Possibly the version of its *last* merged branch.
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

Definition of Done: `docs/definition-of-done.md`.
