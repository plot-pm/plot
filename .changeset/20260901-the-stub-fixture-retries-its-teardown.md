---
'@plot-pm/board': patch
---

The stub fixture's teardown goes through the bounded retry, so a doomed child writing into the tree no longer fails the test that was cleaning up after it. `rmTree` was written for exactly this on 2026-08-31 — with a test proving it absorbs a transient `ENOTEMPTY` — and `helpers.mjs` went on calling `fs.rmSync` directly in the one place every server test tears down through, so the absorption existed and the failure kept happening: six `test:board` runs died there on 2026-08-31, from `port.test.mjs` and `write-gate.test.mjs` alternately, each blaming a test that had passed. Measured after: a first run reports 2525 passed with two `ENOTEMPTY` events absorbed rather than raised. A test on the retry could not have caught this, so the new one asserts the CALLER — `cleanup()` survives an injected transient, and an injected `EACCES` still surfaces, because a retry that swallowed a permission error would be worse than the bug.
