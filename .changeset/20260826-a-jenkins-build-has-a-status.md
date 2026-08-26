---
"plot": minor
---

A team on Jenkins reads its build status from the board, instead of the board
saying nothing and meaning *I never asked*.

`plot-host.sh pr-list --rich` resolves `checks` through `jen` when `## Plot
Config` declares `CI: jenkins`. It lists the multibranch job ONCE per refresh —
the spike measured 45 branches with build results in 0.17 s, so there is no
cache and no per-branch call — and joins each branch's colour onto the host's PR
rows locally. `CI` and `Git host` are independent keys, so the overlay rides on
either backend: a Bitbucket repo with Jenkins gets its PR list from `bb` and its
`checks` from `jen`.

The colour table is the plan's: `blue`→`passing`, `red`/`yellow`→`failing`
(`yellow` is UNSTABLE — tests failed, and a false green on a readiness board is
worse than the blank it replaces), `*_anime`→`pending` (a build is running),
`disabled`/absent→`none` (absent is not failed). Branch names arrive
percent-encoded (`bugfix%2Ffoo`, 27 of 45 measured) and are decoded before the
join, or every slashed branch would miss AS `none`.

An unreachable Jenkins is detected by the `Jenkins auth: NOT reachable` wording
rather than the exit code (`jen` exits 0 while printing it), and marks the
affected rows `checks:"unknown"` while the op still exits 0 — one dead Jenkins
must not blank the whole PR list. Only a `CI: jenkins` repo with no `Jenkins
instance` configured exits 3, because that is a config error the op cannot
proceed past.

The multibranch container path travels on the `Jenkins instance` value as
`<slug>/<job/path>` — the plan's open point resolved without a new config key,
since a multibranch container is the parent of a branch and cannot be derived
from the branch name.

<!--
bumps:
  skills:
    plot: minor
-->
