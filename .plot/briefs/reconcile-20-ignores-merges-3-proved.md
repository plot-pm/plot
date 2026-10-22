## Implementation brief — reconcile-20-ignores-merges-3-proved

- **Plan (canonical):** `docs/plans/2026-10-22-reconcile-20-ignores-merges-3-proved.md` on main
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2332 merged
- **Branch:** `bug/reconcile-20-ignores-merges-3-proved` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (plan PR required; CI green + `plot/review`)

The plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

On a cut Bitbucket merged-PR list (`MERGED_PR_TRUNCATED=1`), §3 of
`skills/plot/scripts/plot-reconcile-scan.sh` asks the host per branch
(`pr-merged`, line 1307) and prints a deletion candidate when the host says
`merged`. §20 (line 2535) only calls `merged_pr_for_branch`, which searches
`merged_pr_heads` — the one bundled 50-row page fetched once in
`load_merged_pr_heads` (line 668). §3's per-branch answer is never folded
back into `merged_pr_heads`, so a branch §3 just proved merged still reads as
absent in §20 and the section prints "(none — no remote ref outlives its
merged PR)" on the same run that §3 called it a deletion candidate.

Fix: when §3's per-branch ask (line 1307) returns `merged`, record
`<pr_number> <branch>` into `merged_pr_heads` (or an equivalent accumulator
`merged_pr_for_branch` also reads) before §20 runs. §20 then lists the ref
with the same evidence §3 already bought, at zero extra host cost.

Separately, both truncation notes (line 1189 in §2, line 2571 in §20) print
`"merged-PR list hit its limit of $MERGED_PR_LIMIT"`, and `$MERGED_PR_LIMIT`
is always 500 (line 399) — the number requested, not the number the host
actually returned. On Bitbucket the real page is 50
(`pr_list_report_truncation`, `plot-host.sh:3033`, already writes
`"possibly truncated ($count rows, requested limit $limit unprovable)"` to
stderr). Capture `$count` from that line (or a stable marker alongside it)
when `load_merged_pr_heads` reads `$host_err`, store it next to
`MERGED_PR_TRUNCATED`, and have both notes print the applied count instead of
`$MERGED_PR_LIMIT` on Bitbucket. GitHub's truncation is a ceiling it honours
(it truncates exactly at `--limit`), so its note keeps naming
`$MERGED_PR_LIMIT` — do not change that arm.

### The decisions the plan settles — do not re-derive them

**Share the answer; do not re-ask.** The plan's Open Question recommends
reuse-only: §20 should NOT make a fresh per-branch `pr-merged` call for every
ref with no row in the cut list — that is one Bitbucket call per orphan
candidate against an account with a documented scarce budget (see the
`my-bitbucket-issues-are-in-the-inbox` brief's note on the account-wide 429
hit from ~1400 requests in one day). §20 reuses only what §3 already bought.
A note may still be warranted that refs §3 never asked about (i.e. refs §3's
loop didn't reach, because they were claims or contained-in-open-PR) can
still be missed — the plan leaves this as an open question, not a
requirement; resolve it in the PR description if you decide either way.

**The record is an answer, never a verdict.** Per `CLAUDE.md`'s *One Answer
To "Did This Land"*: what §3's `pr-merged` ask returns is the host's word,
not ancestry. Fold it into `merged_pr_heads` (or next to it) as a bought
answer with the same shape `merged_pr_for_branch` already parses (`<pr>
<head>`), not as a derived boolean. Do not route it through
`branch_merged`'s ancestry fallback — that fallback exists for branches with
no PR to read at all, and §3's per-branch ask already found one.

**The row count already exists on stderr — read it, don't recompute it.**
`pr_list_report_truncation` (`plot-host.sh:3014`) is the one place that
decides and prints completeness; `load_merged_pr_heads` already redirects to
`$host_err` and `grep -q 'possibly truncated'` against it (line 702). Add a
second extraction (e.g. `grep -oE '\([0-9]+ rows' "$host_err" | grep -oE
'[0-9]+'`) from the same captured file rather than opening a new call path
into `plot-host.sh`. `scripts/check-host-cli-callers.sh` gates who may call
the host CLI directly — the scan must not call `bb` itself, only read what
`plot-host.sh` already wrote to the file it was given.

**GitHub keeps `$MERGED_PR_LIMIT`.** The fix is Bitbucket-only. GitHub's
`--limit` is honoured by the host (it is the ceiling the caller asked for and
got), so `$MERGED_PR_LIMIT` is already the true applied number there — do not
touch that branch of the note.

**§20a (review bypass) is out of scope unless you check it.** The plan's
third Open Question asks whether `review-bypass.ts --limit "$MERGED_PR_LIMIT"`
(line 2592) has the same wrong-limit bug on Bitbucket. It is a separate code
path (`board/plot-review-bypass.mjs`, not `plot-reconcile-scan.sh`'s own
truncation note) and the plan does not commit to fixing it — note in the PR
whether you checked it and what you found, but do not expand the slice to
fix it unless it's a one-line change using the same captured count.

### Done when

The plan's `## Done when` is implicit in its Notes — there is no explicit
`## Done when` list, so the specification is the Motivation's two gaps closed
plus the Notes' test target:

1. A contract test in `test/reconcile/` with a stubbed Bitbucket host that
   returns 50 merged rows plus a per-branch `merged` answer (via `pr-merged`)
   for a branch outside those 50. The test fails on `main` today with §3
   naming that branch a deletion candidate while §20 prints "(none...)", and
   passes once §20 lists the ref with the same evidence.
2. A second assertion in that same test (or a sibling) checks that both
   truncation notes name 50 (the actual page), not 500 (`$MERGED_PR_LIMIT`).
3. The GitHub arm's truncation note is unchanged — add or keep a test
   asserting it still prints `$MERGED_PR_LIMIT` there, so the Bitbucket-only
   fix doesn't regress the host that already has an honoured ceiling.

Plus the repo's standing gates: no generated board bundle in the diff
(`scripts/check-no-bundle-diff.sh`), and if this branch grows the shell under
`skills/`, `scripts/check-shell-lines.sh` requires removing an equal number of
lines elsewhere in the same change — there is no override.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints. The suites in the `CI suites` config key (including
`node --test test/reconcile/*.test.mjs`) run in CI on every PR — do not run
the full e2e suite locally (see `CLAUDE.md`'s Testing section: it dispatches
real workers into sandbox repos and is CI's gate, not a local one).

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Push the first real commit as soon as it exists — a branch with nothing
beyond a `PLOT-BLOCKED` marker carries no bookkeeping duty, but once real work
lands, push it rather than batching to the end. When the PR is created,
append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` (§2, §3, §20
and the shared `load_merged_pr_heads`/`merged_pr_for_branch` helpers) and any
new or extended test file under `test/reconcile/`. It does not touch
`plot-host.sh`'s truncation detection itself (`pr_list_report_truncation`
already does the job; this slice only reads its existing stderr line more
closely) and does not touch `board/plot-review-bypass.mjs` unless the §20a
check above turns up a trivial shared fix.

No other branch is in flight against this plan — it is a single-slice plan
with no wave structure, so there is no sibling branch to collide with.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
