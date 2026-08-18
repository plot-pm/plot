---
"plot": patch
---

plot-host: translate --state into Bitbucket's vocabulary before sending it

`plot-host.sh` is the one adapter over both hosts, and it already knew the two
vocabularies differ — every response mapper turns Bitbucket's DECLINED into
CLOSED. The translation only ever ran in that direction. The request carried the
caller's GitHub word unchanged, so `bb` rejected `--state all` and
`--state closed` outright and every history-wide query failed:

```
error: invalid --state 'ALL' (must be open, merged, declined, or superseded)
```

Observed 2026-08-18 against bitbucket.org with `bb` 1.0.0, where it left every
PR-dependent group on the board reporting "PR data unavailable".

`all` becomes SEPARATE CALLS rather than repeated flags. Measured: `bb` accepts
`--state open --state merged` and silently keeps only the last, returning 50
PRs — all MERGED, with the 3 open ones gone. No error, a plausible list, and the
wrong answer. One call per state avoids depending on a `bb` fix, and the three
states partition the set (74 PRs, 74 unique ids, 0 duplicates on the repo
measured).

`superseded` is deliberately not part of `all`: such a PR is replaced by a newer
one for the same branch, and a board with one row per branch would show that
branch twice. `gh`'s `all` has no equivalent, so nothing is lost — a caller
wanting it asks by name.

The GitHub path is unchanged, and was regression-checked: `--state open` and
`--state all` both still return PRs.

<!--
bumps:
  skills:
    plot: patch
-->
