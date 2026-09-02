---
'@plot-pm/board': patch
---

A deferred branch's row says why it was given up, and a refused *Start work* says what the server refused. Both sentences existed and neither reached the reader: a withdrawn plan keeps `Phase: Draft` deliberately, so its row read *plan not approved yet — still in review* about a decision its author had already made; and `/api/dispatch` answers a refusal with `detail`, which the button did not read, so a 409 rendered as a bare `HTTP 409`.
