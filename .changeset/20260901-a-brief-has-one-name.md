---
'@plot-pm/board': patch
---

One `briefPath` for the board instead of five copies. `attention.ts`, `auto-dispatch.ts`, `continue.ts` and `fleet.ts` each computed a brief's path from a branch name, and the rule they held is easy to get subtly wrong: the branch prefix is **dropped**, not flattened, so `feature/a-brief-has-one-name` gives `.plot/briefs/a-brief-has-one-name.md` and never `feature-a-brief-has-one-name.md`. A flattened name is a file no reader computes, so a brief written that way is invisible to the dispatch gate and the branch reads as having none. `brief-path.ts` is a leaf module importing only `node:path`, so every reader can take it without a cycle, and `briefPathForSlug` names the `same-branch` case whose plan rides a branch it did not cut.
