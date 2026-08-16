---
"plot": patch
---

Conflicts in the board bundle are settled by rebuilding, not by reading.

`skills/plot/scripts/board/board-server.mjs` is generated output: **177 lines holding 796 KB**, roughly 4,500 characters each. Git merges line by line, so every board change — whatever source file it came from — lands in the same handful of enormous lines. Two branches touching entirely disjoint sources still collide there, and the diff cannot be meaningfully read.

That was the binding constraint on parallel board work, three times on 2026-08-16. PR #141 demonstrated it while the plan was being written: `merge-tree` named exactly one conflicting file, this one, with zero source conflicts. `App.tsx` and `AgentList.tsx` merged cleanly; the generated bundle did not.

**A conflict in a reproducible file is not information.** `pnpm build:board` regenerates the artifact from sources that merged cleanly, so any version of it is exactly as good as any other. `.gitattributes` now marks it `-merge`, and git stops trying to reconcile it.

The measured difference is sharper than "no conflict". Without the attribute, git splices conflict markers **into** the bundle, leaving 796 KB of unparseable JavaScript that a rebuild cannot even run against. With it, git keeps one version whole and reports the conflict, so the file stays valid and buildable:

```bash
git checkout --ours skills/plot/scripts/board/board-server.mjs   # either side
pnpm build:board
git add skills/plot/scripts/board/board-server.mjs
```

**An attribute, not a custom merge driver.** `merge=rebuild` invoking the build is the more elegant idea and the more dangerous one: `.gitattributes` is versioned and travels with the repo, but a driver *definition* lives in each clone's `git config`. On CI and fresh clones the attribute would name a driver that does not exist, and git falls back to a normal merge **silently** — a rule that works only where someone remembered to install it.

**The resolution names no side, and that is load-bearing.** Measured on the real artifact: a `git merge` keeps the branch being merged into, a `git rebase` keeps the upstream. "Ours" inverts between them, and agents here rebase routinely, so a side-named instruction is right in one flow and wrong in the other. Since the rebuild overwrites whatever was kept, the instruction is *take either version, then rebuild*.

**The file stays in git and the CI gate is untouched.** `pnpm board` starts it with no build step and the plugin ships it; CI runs `pnpm run build:board` itself and byte-diffs, so the committed file is an expectation rather than an input. The gate is what keeps this honest — resolve by keeping a stale artifact and forget to rebuild, and the no-diff check fails. The strategy removes the *conflict*; the gate still enforces *correctness*.

`test/reconcile/artifact.test.mjs` asserts this against the real artifact rather than a fixture, since the 177-line shape is what causes the failure: that disjoint-source branches leave the bundle whole and marker-free, that a merge and a rebase commit byte-identical artifacts, that it works in a clone which configured nothing, and — as a control — that without the attribute the same merge corrupts the file.

One thing this deliberately does **not** change: `git merge-tree` still predicts the conflict, because `-merge` governs how git *resolves* the file rather than whether it *reports* one. `plot-merge-queue` therefore goes on flagging every board pair — now over-cautious rather than wrong, since what it names costs a rebuild instead of an afternoon of reading. Prediction is this plan's second wave; the behaviour is pinned in a test so it is recorded rather than rediscovered.

The procedure is documented in `docs/definition-of-done.md`, with the short form in `CLAUDE.md` and `AGENTS.md` where an agent hitting the conflict will already have it in context.

<!--
bumps:
  skills: {}
-->
