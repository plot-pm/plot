---
plot: patch
---

The reconcile scan now distinguishes three CLI failure modes that were previously
collapsed into one "degraded" state, reporting stale branches that had open PRs.

**The measured bug**: a 429 (rate limit) from `bb pr list` caused `jq` to read
empty input and exit 0, so `$?` was jq's exit status and the only check was
`[ -n "$out" ]` — indistinguishable from "zero open PRs". Section 3 then
printed every unmerged branch as stale, because none matched the empty PR list.

**The fix**:

1. `load_open_pr_branches` now captures stderr, tests the CLI's *own* exit
   status (not the pipeline's), and treats empty output as a value when the CLI
   exits 0 (zero open PRs), not as a failure.

2. `PR_SOURCE` is now one of five named states: `absent` (no CLI installed),
   `failed` (CLI present but call failed), `gh`/`bb` (success), `off`
   (deliberately skipped via `--no-pr`/`--offline`), or `degraded` (unknown host,
   kept for backwards compatibility).

3. Section 3 (stale branches) is **suppressed** when `pr_source` is `absent` or
   `failed`: no rows are printed, but the reason and branch count are stated.
   `stale=` reports 0 when the section was not evaluated — a consumer counting
   `stale=12` from an unevaluated section would be handed a number nobody
   measured.

4. The PR state header now shows the CLI's own error text beside the state, so
   the reader sees "PR state: FAILED — HTTP 429: rate limit exceeded" rather
   than a silent demotion to git-only mode.

5. `--no-pr`/`--offline` keeps today's behaviour: rows are printed with a
   warning, because the caller explicitly asked for git-only mode.

<!--
bumps:
  skills:
    plot-reconcile: patch
-->
