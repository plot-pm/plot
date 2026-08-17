---
---

board: a row flashes on any observed fact that changed, not only its PR

`watchedState` watched one thing — `pr.state` — so a row that changed
section, gained unpushed commits, became dirty or got stuck did it
silently. The marker existed to say *this just changed* and only ever
answered about the git host.

It now watches every **observed** fact on the row: PR state, number and
draft flag, git state, group, wave, phase, the three local signals, and
stuck. Derived time is deliberately excluded — a ticking clock is not
news, and including `ageMinutes` would flash every row on every pulse.

**The unreadable case is the hard one, and it is settled per slot.** A
PR whose host could not answer reports `unknown`, and `unknown` is not a
value: it is the absence of one. So the memory carries the last KNOWN
state forward across an outage — `green → unknown → failing` still
flashes, because the memory still holds `green` when `failing` arrives —
and only the moment is skipped, never the fact.

Per slot rather than per row: a GitHub 503 says nothing about whether a
worktree is dirty, and freezing the whole record for a remote host's
reason would silence an agent's edits exactly while it writes.

For a row first seen while the host was down there is nothing to carry.
It is recorded honestly as `unknown`, and `sameWatched` treats `unknown`
on either side as **not comparable** rather than as different — a
sentinel chosen to compare as changed would flash the host's *recovery*,
which is news about GitHub rather than about the branch. The stated cost:
such a row does not flash on the first state it is finally seen in;
`prNumber` going from null to a number covers most of it.

`isObservation` is renamed `isUnreadable`. It returned true for
`unknown` — the one value that is *not* an observation — so it read as
its own opposite at every call site.

<!--
bumps:
  skills:
    plot: patch
-->
