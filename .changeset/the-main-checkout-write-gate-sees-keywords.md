---
"plot": patch
---

The main-checkout write gate now reads a git call behind a leading `if`, `for`, `{`, `!`, `time`, or a single `&`, matches `tag`, `notes`, `clean -f` and `fetch <src>:<dst>` as mutating (with `tag -l`, `notes list`/`show`, `clean -n`/`--dry-run` and a colon-less `fetch` staying read-only), and skips the body of an unquoted or quoted heredoc so a git call written there is not refused. A continuation no longer inherits its parent's `PLOT_MAIN_CHECKOUT_WRITER` marker into the spawned worker's environment.

<!--
plan: docs/plans/2026-10-24-the-main-checkout-write-gate-misses.md
bumps:
  skills: {}
-->
