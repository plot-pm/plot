---
'@plot-pm/board': patch
---

The board says so when the git host could not be reached, instead of presenting
the last readable answer as the current one.

`prError` was set in one place only — a `catch`. A spent GitHub quota does not
throw: `gh` returns successfully with every PR carrying `state: 'unknown'`, and
the success path nulled the field one line earlier. So the banner stayed silent
through the outage while merged work read as work awaiting review.

`refreshPrs` now carries a second, content-based trigger beside the exception
one: an all-`unknown` PR map — the shape a quota failure takes — records the
failure and raises the banner, keeping the last good map so rows stay classified
as they were. A single unknown PR among readable ones raises nothing; one gap is
a gap. A thrown failure still sets `prError` and still shows the banner — the
new trigger joins the catch rather than replacing it.

The banner names the age of the data still on screen, from `prAgeSeconds` —
"showing data from 14 min ago" — so a reader cannot mistake a stale board for a
live one. The full error message is kept, naming the failing script for
diagnosis.
