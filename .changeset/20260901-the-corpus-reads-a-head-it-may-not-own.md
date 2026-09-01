---
'@plot-pm/board': patch
---

The corpus tier runs on a checkout that has no `origin/HEAD`, which is what CI gives it. `actions/checkout` fetches the ref it was asked for and creates no `origin/HEAD`, and the suite required it twice — `git symbolic-ref --short refs/remotes/origin/HEAD` at module scope and `git rev-parse origin/HEAD` in `beforeAll`, both unguarded, both exiting 128 before a single test ran. The file reported `0 test` and the job failed with nothing to point at, so `main` went red on 2026-09-01. It passes locally because a working copy made by `git clone` has the ref. The pin is now resolved from `refs/remotes/origin/<main>` — the ref the scan would have derived anyway — so the suite no longer depends on the very ref it replaces, and `MAIN` falls back to `main` when nothing names it. Verified both ways by deleting the ref and running the tier: 13 passed with `origin/HEAD` present and 13 with it absent.
