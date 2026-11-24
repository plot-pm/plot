---
'plot': patch
---

The Fleet card's registry fact no longer counts a finished desk as an agent with no registry file. A desk no manifest names is finished where its worker ended and the PR index holds a merged PR for its branch (`isFinishedDesk`); the registry reports these as `finishedCount`, and `registryFact` leaves them out of both of its counts. An unreadable index counts no desk as finished.
