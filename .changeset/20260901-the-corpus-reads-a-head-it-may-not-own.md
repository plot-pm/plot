---
'@plot-pm/board': patch
---

The corpus tier runs on a checkout whose `origin/HEAD` is a direct ref, not only on a clone. It read the branch to restore with `git symbolic-ref --short refs/remotes/origin/HEAD` at MODULE SCOPE, which exits 128 where that ref is direct rather than symbolic — so the file reported `0 test`, the corpus job failed with nothing to point at, and `main` went red on 2026-09-01. It passed locally for exactly the reason it failed in CI: a working copy made by `git clone` has a symbolic `origin/HEAD` and `actions/checkout` need not. The read now tolerates both shapes and falls back to `main`, and the `afterAll` restoration stays best-effort — a suite that could not read a ref it never pinned should still run. Verified against both shapes by deleting the symref, recreating it as a direct ref, and running the tier: 13 passed either way.
