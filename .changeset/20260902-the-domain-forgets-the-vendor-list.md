---
'@plot-pm/domain': patch
'@plot-pm/board': patch
---

`HostBackend` is a string the domain does not validate, so a third git host
costs an adapter rather than a domain edit.

The closed enum `'github' | 'bitbucket'` was protecting something real: two
`fleet.ts` expressions branched on the backend's name to decide whether to pass
a reset reader, and a word that reached them unnarrowed would have been a
runtime question where the type asked a compile-time one. Removing the enum
before those branches existed would have traded a check for nothing.

#661 landed the header-read budget behind them, and this removes the branches
themselves. The reset reader asks the connector through `limit()`, which reports
one reading per bucket with the reset it stated; the soonest future `actual`
reading is the wait, and a connector that meters nothing answers null — the same
ceiling a host with no limit API already fell back to, without this having to
know which host that is. `fetchGraphqlResetMs` goes with them, its `gh api
rate_limit` call being the only thing the vendor branch selected.

**The refusal moves rather than disappearing.** `host-shell.ts` keeps a `DRIVES`
list and still fails on a backend it cannot drive, naming the word it could not.
That list belongs to the adapter because the adapter is the layer that could act
on it — driving a host means a CLI `plot-host.sh` has been taught, and adding one
is an edit to that file and the script beside it.

The domain now names a vendor in exactly two places, both under `adapters/`,
which is the property `Ports § A connector is a kind of adapter` records as a
target. `LimitReading.connector` and the `CI` backend already read this way; `Git
host` was the outlier.
