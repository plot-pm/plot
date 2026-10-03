---
'@plot-pm/board': patch
---

`bashCleanliness` excuses a generated board bundle a worktree rebuilt locally, derived from that worktree's own `packages/board/build.mjs`, so a desk holding only a rebuilt bundle is still droppable. `mayResolve` now refuses every `artifact-conflict` unconditionally: the board's one automatic write — rebuilding and pushing an artifact-only merge conflict — is switched off, since a PR must never carry a generated bundle.
