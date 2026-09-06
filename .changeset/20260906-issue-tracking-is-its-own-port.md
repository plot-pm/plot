---
'plot': minor
'@plot-pm/board': minor
---

Issue tracking has its own port. A tracker is not a git host: `Tracker` is a
`## Plot Config` key declared independently of `Git host`, so a repository whose
code lives with one vendor and whose tickets live with another had two foreign
services answering through one interface. The conflation was visible in the host
port's own text — `issueList` reported `unaskable` *"where the host has no
tracker at all"*, one interface saying not-my-department about a capability
belonging to a different service.

`ports/tracker.ts` holds `issueList`, `issueView` and `statusWrite`, and both
issue operations leave `ports/host.ts`. Two connectors implement it rather than
one adapter with a vendor branch: each holds its own account, token and window,
and neither ever sees the other's — asserted, each reports its own limit buckets
and never the other's.

`plot-host.sh` gains `issue-status`, the one write to a tracker. It records a
status and nothing else: no ticket is created, none closed, no comment, label or
assignee touched. The transition id is looked up rather than guessed, because
ids are per workflow and per issue and a hardcoded one writes to the wrong
column. CLAUDE.md's *"The two issue ops READ and never write"* is amended in the
same change rather than quietly broken — a plan referencing an issue stays
Plot's record, and the status is the one fact the tracker owns a copy of.

`plot-update-board.sh` becomes the write arm of one connector rather than the
whole write path. It never asked which tracker a repository uses — zero
references to `Tracker` in the script — and it exits 0 on a graceful skip, so
the connector reads its warnings instead of its exit code.

A repository with no `Tracker` gets `trackerNone`, which answers `unaskable` on
every operation including the write. Asserted, because a silent no-op there
reports a status reaching a tracker somebody configured while nothing left the
machine. An unrecognised scheme resolves the same way rather than falling
through to the git host, which would list one vendor's issues under another's
name.

`packages/board/src` still holds zero live host calls.

<!--
bumps:
  skills:
    plot: minor
-->
