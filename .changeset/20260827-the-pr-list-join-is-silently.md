---
"plot": patch
---

`plot-host.sh pr-list` reports a possibly-truncated page instead of serving it
as the whole set (#333).

`pr-list` returns a bulk page that two consumers — `plot-fleet-scan.sh` and the
board's PR timer in `fleet.ts` — join locally. On Bitbucket, `bb pr list` has no
`--limit` flag and returns a fixed page (50 at bb 1.0.0), so past 50 PRs per
state the page is a partial set. Every branch beyond it joins to nothing and
reads as *no PR* — the fabricated verdict the scan refuses everywhere else.
Measured 2026-08-26 against a real Bitbucket repo: 50 merged PRs (ids 836→787)
against a repo numbering to 836, ~780 older merged PRs invisible to the join.

The repair lives inside `pr-list`, the ONE place that talks to the host CLI, so
both consumers benefit and neither changes. Detection is against the requested
limit being unprovable, never the constant 50:

- **github** honours `--limit`, so a state is possibly truncated only when it
  returns *at least* the requested limit; fewer rows proves completeness.
- **bitbucket** ignores `--limit` and can report no total and no cursor, so it
  can never prove completeness for a `--limit` call — any non-empty page is
  possibly truncated, an empty one had nothing to hide.

The report goes to **stderr**, per state, not a stdout sentinel: both consumers
parse every stdout line as a PR record (`fleet.ts` casts each line with no
discriminator check), so a sentinel would enter the join as a phantom
`{number:undefined}` — a new silent corruption while fixing an old one.

Closing the ~780-PR gap by asking `bb` per id is unaffordable (~10s per call, no
bulk primitive), so no per-branch fallback is shipped — the honest-truncated
half only makes the incompleteness visible to an operator and machine-readable
for a future diff, without turning every Bitbucket pulse into minutes of
latency.

<!--
bumps:
  skills:
    plot: patch
-->
