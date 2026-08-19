---
"plot": patch
---

ci: a hung step fails instead of blocking

Measured 2026-08-19: **eleven runs hung on `Install Playwright browser`**,
10 to 57 minutes each, every one ended by hand. Roughly two to three
hours of waiting in one day, spent on the same manual remedy — cancel,
re-run, watch.

The defect was never the slow CDN. It was that the hang **did not fail**.
`.github/workflows/ci.yml` carried no `timeout-minutes` anywhere, so a
wedged download ran against GitHub's 360-minute default, and a run sitting
in `in_progress` is indistinguishable from one doing work.

Three bounds, and a cache so the common case stops needing them:

- `timeout-minutes: 3` on the browser install — the step takes ~45 s warm
  and ~90 s cold, and every measured hang sat past 10 minutes with no
  output. A tight bound turns silence into a fast, re-runnable failure.
- `actions/cache` for `~/.cache/ms-playwright`, keyed on the resolved
  Playwright version rather than the lockfile hash: the browser build is
  chosen by that version and nothing else, so an unrelated dependency
  change must not evict a browser that is still correct.
- `timeout-minutes: 15` on the integration suite and `25` on the job — a
  ceiling rather than a target. A green run is about 7 minutes.

This is the repo's own "Gates Over Rules" rule applied to its pipeline: a
timeout is a gate, and watching for hangs was a rule somebody had to
remember.
