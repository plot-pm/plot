---
"plot": patch
---

Report ambiguity instead of guessing, and pin the resolution path that no test covered.

A second adversarial audit — this time of the recent additions — found two things worth blocking a release for.

**`plot-context.sh` picked a plan by filename order.** When two active plans listed the same branch, the lookup broke on the first glob hit, so the "governing plan" was whichever symlink sorted first alphabetically. Renaming a file changed the answer while nothing about the work changed, and nothing signalled that a choice had been made. The script's own header promises the opposite — "a durable decision record attributed to the wrong plan is worse than one with no attribution" — and a silent pick produces exactly that. It now reports `ambiguous: true` with the candidate list and leaves `plan_slug` empty.

**The `idea/` fast path had no test.** Disabling it left every test green, yet it is the only route that resolves a plan sitting on its own idea branch before any Branches section names it — the primary path, invisible to CI. Now pinned, and verified by sabotage in both directions.

Three smaller findings from the same audit: `plot-detect-repo.sh` matched hosts by substring, so `git.mybitbucket.internal.example.com` read as Bitbucket and a path segment could spoof GitHub entirely — the globs are now anchored to the host position. It also read only the root `package.json`, reporting "no quality gates" for a monorepo, which is the worst possible miss given that the Definition of Done is the one question `/plot-init` insists on; workspace packages are now read too. And the RC checklist cited the wrong test count.
