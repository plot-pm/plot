---
'@plot-pm/board': minor
---

Replace four status counts with three exhaustive buckets

The sprint control now shows three exhaustive buckets (open/WIP/done) instead
of the previous four status counts (delivered/deliverable/inProgress/approved).

**What changed:**
- `SprintCounts` schema now has `{total, open, wip, done}` instead of
  `{delivered, deliverable, inProgress, approved}`
- Every non-deferred member lands in exactly one bucket:
  - **open**: Draft, open, or Approved with no branch in flight
  - **wip**: in-progress or deliverable
  - **done**: delivered (or released)
- The display format is now `<total> members · <open> open · <wip> WIP · <done> done`
- The invariant `total === open + wip + done` is maintained by construction

**Why:**
- The old four buckets silently dropped Draft members (counted nowhere)
- A reader comparing the control against columns could not verify the math
- Three exhaustive buckets make omissions visible: if the sum doesn't match,
  something fell through
