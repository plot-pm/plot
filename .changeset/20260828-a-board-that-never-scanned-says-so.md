---
'@plot-pm/board': patch
---

A board that has never completed a scan says so.

The warming state existed and was right — *"a tab that has never had an answer
cannot have one it no longer trusts"* — but it was gated on `!fleet.error`. Any
failure skipped it, and the reader got the ordinary view instead: every section
rendering `none`, under an amber *Last scan failed* line. **At a glance that is
a healthy board over an empty estate.**

The amber line hedged the wrong way too. It appends *"showing the last
successful pulse below"* only when `ready` is true, so a board that had never
scanned said nothing at all about the emptiness beneath the error — the fact a
reader most needs.

Measured 2026-08-28 against a board installed from npm: the truth for ten
seconds, then indistinguishable from a working board, forever. Two readers
concluded the release was broken. It was not.

The `!ready` case now owns its render whether or not an error is set, and states
both facts in the reader's order — what they are looking at, then why. The
sections are **suppressed rather than filled**: rendering `none` per section is a
claim about the repository, and a board that never scanned has no basis for one.
The error text is kept **verbatim**, because a friendlier message that dropped
`bash exited 127` would have made the diagnosis impossible.
