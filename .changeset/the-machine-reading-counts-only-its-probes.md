---
'plot': patch
---

The board's and fleetd's machine reading times its `git` probes synchronously, so time the measuring process spends on other work, such as building a board response, no longer counts as fork cost. An idle machine that read `tight` while board tabs were open now reads `clear` (#3533).
