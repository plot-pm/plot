---
"plot": patch
---

Every entry bundle under `packages/*/src/server/entry/` now ends through `endEntry`, a new `@plot-pm/domain/adapters/entry-exit` helper that writes an empty chunk to stdout and to stderr, each with its own callback, before calling `process.exit(code)` — so the exit waits for both streams to confirm a queued write has actually left. A bare `process.exit(code)` does not wait: past about 64 KB, the pipe buffer on both macOS and Linux, `plot-ask.mjs board` lost 89% of a 595,679-byte answer and `plot-ask.mjs fleet` broke `jq -e .` on the receiving end with an unfinished JSON term. An EPIPE on either stream still exits at once. `scripts/check-entry-exit.sh` refuses any `process.exit` token on a non-comment line under that tree, with no allow-list, and runs in both local checks and CI.

<!--
plan: docs/plans/2026-10-27-bundle-entries-exit-before-stdout-drains.md
bumps:
  skills:
    plot: patch
-->
