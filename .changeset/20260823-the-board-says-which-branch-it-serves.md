---
'@plot-pm/board': minor
---

The board header names the branch its server is serving from. `pnpm board` serves the artifact built in whichever of this repo's 22+ worktrees it was started in, so a reader who sees a layout they changed can now tell whether they are looking at that branch's artifact or another's. `serverInfo()` reads `git branch --show-current` once at startup and memoises it — the fork stays off the per-request path. A detached HEAD (several worktrees here are) reports empty and the header renders no element, rather than a chip reading `unknown` or a fabricated short SHA. The name is muted secondary weight: context, not one of the two states a reader acts on.
