---
'@plot-pm/board': patch
---

Every test teardown removes its tree through `rmTree` rather than calling `fs.rmSync` directly. `rmTree`'s first attempt IS the identical `fs.rmSync(target, { recursive: true, force: true })`, so a clean removal returns from it with no behaviour change and no delay — it only retries where a spawned process is still writing, which is the `ENOTEMPTY` a teardown races. Every teardown was converted rather than only the racing ones, because the racing population is not nameable: *"removes a directory a spawned process wrote in"* is a judgement no grep decides, while *"a test teardown does not call `fs.rmSync` directly"* is gateable. One site remains, inside `rmTree` itself, which is the one place that should have it.
