---
"@plot-pm/board": minor
"plot": minor
---

<!--
bumps:
  skills:
    plot: minor
-->

board: an issue is a signal the board can see

Three issues sat open for hours — #226, #227 and #228 — each written with
request counts, timings, file paths and line numbers already in place. None
appeared on the board, because the board reads `docs/plans/` and an issue is
not a plan. Correct by the old design, and useless: the work existed and
nothing surfaced it.

WAITING ON YOU now lists open tracker issues **no plan references**. The
section is for what needs a human decision, and the decision here is not *fix
it* — it is *is this worth a plan?*

Not a fifth phase. The manifesto keeps issues as the inbox — signals, not
commitments — and the four phases describe the path of a plan. So this is a row
that is **not a plan**: `IssueRow` is its own shape rather than an `AgentRow`
with six empty fields, because every field on that type describes a branch and
an issue has not entered the lifecycle.

The row takes the PR row's shape on the same seven tracks, with an issue glyph.
Three refusals, each removing a fabrication:

- **the inferred plan name is text, never an anchor** — nothing is behind it
  yet, and a link to a plan that does not exist is the fabrication this board
  keeps removing
- **the branch column is empty** — a derived name would be indistinguishable
  from a branch nobody has claimed, a row this board already renders and which
  means something else entirely
- **the number links to the tracker only when the host gave an address**,
  following `PrCell`'s own rule rather than inventing a URL

`plot-plan-meta.sh` gains `issues`, read from a dedicated `## Status` `Issue:`
line rather than from a scan of the body for `#NNN`. The plan asked which, and
a body scan cannot tell a signal from a citation: the plan introducing this
field cites #226, #227 and #228 as history in its Motivation while naming
PR #232 two sections later. `prs` already answered the same ambiguity by
reading only `→ #NNN`.

`plot-host.sh` gains read-only `issue-list`, and three outcomes stay apart: an
empty list means the host answered, a non-zero exit with empty stdout means the
question failed, and exit 4 means the host cannot be asked at all (`bb` exposes
no issue listing). `issueAnswer` carries that distinction to the client and
defaults to `unsupported`, so an older server's silence never renders as an
inbox that is clear — a failed lookup says so in the section rather than
showing nothing.

The reference is what makes a row disappear, and it is read from every plan
file rather than from the fleet pulse: the pulse carries a rolling 24 hours of
delivered plans, which is the right window for branches and the wrong one for
decisions. A plan delivered last week is still the decision about its issue.

Read-only in both directions — no labels, no assignees, no close-on-merge.
