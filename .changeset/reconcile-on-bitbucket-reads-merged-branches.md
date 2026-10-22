---
'plot': patch
---

`plot-reconcile-scan.sh` no longer names a Bitbucket branch an orphan when its merged PR sits past Bitbucket's fixed 50-row listing page.

`plot-host.sh` already decided whether a listing page could prove completeness and reported it on stderr ("possibly truncated"), but the scan discarded that line and only ever set `MERGED_PR_TRUNCATED` at its own 500-row GitHub ceiling — a ceiling Bitbucket's 50-row page never reaches. Fixed on ewz-kus-portal (#2282): `bug/ewzkus-3678-sd-rechnungen-rechnungsliste` printed as an orphan although `plot-host.sh pr-merged` already answered `merged` for PR #3623, 90-odd merges behind the newest page. The scan now reads the adapter's stderr signal, and on a cut Bitbucket list asks `plot-host.sh pr-merged <branch>` for each branch about to be called an orphan before printing the verdict; a `merged` answer reclassifies it, and `unknown` or a failed ask leaves the orphan line in place. GitHub is unchanged — its own `--limit` ceiling already proves completeness and the scan makes no extra call there.

<!--
plan: docs/plans/2026-10-21-reconcile-on-bitbucket-reads-merged-branches.md
bumps:
  skills:
    plot-reconcile: patch
-->
