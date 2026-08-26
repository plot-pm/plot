---
"plot": patch
---

The Git-host adapter verifies that `bb` supports `--json` before calling it.

Two tools share the name `bb`. craftamap/bb (a Go binary, 0.6.0) does NOT
support `--json` for PR commands. Quatico's `bb` (a shell wrapper) does.
Their version numbers name different products — craftamap 0.6.0 is not
"older than" Quatico 1.0.0.

Before this change, the adapter passed `--json` to `bb pr list` and swallowed
any rejection. Against craftamap that rejection is `Error: unknown flag:
--json`, and with stderr discarded the call returned empty — every Bitbucket
PR list read as *no PRs*. Worse: craftamap 0.6.0 panics (SIGSEGV) under an
HTTP 429, and a segfaulting CLI is indistinguishable from a quiet one when
stderr is discarded.

The adapter now:
1. Checks the capability ONCE per run, before the first `bb` PR call
2. Identifies which `bb` answered (craftamap/0.6.0, quatico/1.9.0, etc.)
3. Exits 3 with a reason naming the binary when it cannot do `--json`
4. Treats a segfault during the check as a failure, not an empty answer

The check is per-FLAG, not per-version — a high version number that rejects
`--json` is still rejected.

<!--
bumps:
  skills:
    plot: patch
-->
