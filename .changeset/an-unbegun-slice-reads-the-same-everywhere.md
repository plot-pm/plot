---
'@plot-pm/board': patch
---

A slice whose branch state is `waiting` or `blocked` (it declares `<!-- waits: … -->`) now renders in NOT STARTED as a slice row with its status word and its waiting age, and its plan head shows the age too. The server decides once, through `hasNoWork`, that `open`, `waiting` and `blocked` branches carry no work, and carries the answer on the row as `unbegun`; `waitingDays`, `waitingOnFor` and the client's `isUnbegun` read it. `unknown` stays outside the set. A plan head now counts its own slices and the slices elsewhere from one set, the slices its rows belong to, so a slice in WORKING no longer counts both here and elsewhere (#1297, #1301).
