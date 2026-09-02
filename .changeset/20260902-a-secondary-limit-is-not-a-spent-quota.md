---
'plot': minor
'@plot-pm/board': minor
'@plot-pm/domain': minor
---

The banner names which limit was hit, and prints a reset only where the reset describes it.

Two ceilings were reported as one word. `host_failure_kind` matched a single regex and returned `throttled` for every match of it, so *"API rate limit already exceeded"* and *"You have exceeded a secondary rate limit"* came back identical; `hostErrorState` mirrored that with `/rate limit/i.test(error)`, and `prNote` printed one wording over both — including `service returns in ~${when}` from `prNextInSeconds`, which describes the primary bucket and nothing else.

**Both limits were measured here, and they recover minutes apart.** 2026-08-27: eight workers against a cap of seven produced a 403 naming abuse detection. 2026-09-01: `gh pr view` refused with *"API rate limit already exceeded"* while the same account's GraphQL headers read 4854 of 5000 remaining — a bucket with 97 % left does not refuse on quota. A spent quota returns at the reset, minutes away, and the honest reaction is to stop until then and say when; a secondary limit clears in seconds and the reaction is to retry shortly and run fewer calls at once. One word for both counsels a wait of minutes for a ceiling that has already gone.

`plot-host.sh` now answers `throttled|secondary|failed` and carries the second out as exit 6 beside exit 5. **The secondary test runs first, and the order is the classification:** GitHub's secondary message contains the phrase *"rate limit"* too, so a quota test applied first claims every secondary refusal and the distinction is lost at the point it is made.

**The wording decision lives in the domain**, per the rule that every rendered state is a domain property. `refusalKind` classifies, `resetApplies` says whether the reset describes the limit that refused, and `host-notes.ts` reads the answers rather than deciding.

**The secondary banner names how many spenders the record found**, because the fix for local contention is closing a board rather than waiting for GitHub. The count comes from the record and never a headcount — the spenders are eleven scripts, the board, and a person at a terminal, so a process count misses the person. `localSpenders` divides the observed rate by `boardSharePerHour`, the same share the cadence already divides by, so the two numbers cannot drift.

**A refusal still corrects only the prediction it is evidence about.** `correctForRefusal` moves on `throttled` and not on `secondary`: a burst refusal bounds requests at once and says nothing about the hourly ceiling. The concurrency bound is a later slice.

The cadence is untouched. It divides on observed spend and never on a refusal.

<!--
bumps:
  skills:
    plot: minor
-->
