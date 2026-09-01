---
'plot': patch
---

The `Trees` port answers a worktree's dirty paths, so a caller asks the port rather than shelling out to `git status` itself. `trees-reads.test.ts` asserts it against real checkouts — the port's promise is about what git reports, and a mock cannot make that claim.
