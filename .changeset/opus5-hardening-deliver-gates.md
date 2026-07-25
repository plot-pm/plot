---
"plot": minor
---

`plot-deliver` Step 5 now requires subagents to cite a file path for every deliverable they claim is implemented. A deliverable asserted without a path is marked **Missing**, not Done — the orchestrator consolidates cited evidence rather than subagent conclusions.

Step 4 gains an explicit re-query rule: branch and PR state always comes from fresh `gh`/`git` output, never from recollection or from a claim made earlier in the session.

Most of `plot-deliver` was already mechanically verifiable — Steps 4, 4b and 7 are `gh`/`git` checks, and Step 7b is an exemplary gate. Step 5 was the exception: it delegated diff review to parallel subagents and consolidated their returned text with no requirement that any of it be substantiated. The closing human confirmation is deliberately unchanged; a human remains the final authority on delivery.

Deletion pass, same change: removes the Step 5 model-tier blockquote, which restated the `## Model Guidance` table twelve lines above it, and compresses the added prose. Net word count on the file goes down, not up.

<!--
bumps:
  skills:
    plot-deliver: minor
-->
