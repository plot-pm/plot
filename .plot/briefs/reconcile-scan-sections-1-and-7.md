## Implementation brief — reconcile-scan-sections-7-20-24 (wave 2: Scan sections)

- **Plan (canonical):** `docs/plans/2026-10-24-reconcile-scan-sections-7-20-24.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2506 merged
- **Branch:** `bug/reconcile-scan-sections-1-and-7` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 (`bug/reconcile-config-and-plan-meta` → #2575, `bug/reconcile-corpus-and-scan-tests` → #2671) is merged. This branch is the first of wave 2; `bug/reconcile-scan-sections-22-24` waits on it — both edit `plot-reconcile-scan.sh`, and the wait avoids a rebase of a 3000+ line file rather than any data dependency between the two slices' fixes. Open this PR and get it merged before `-22-24` starts.

### What to build

Three findings from issue #2479, all in `skills/plot/scripts/plot-reconcile-scan.sh` section 1 (both-links drift, around line 1058) and section 7 (uncut slices, around line 1512). Line numbers below are current-`main`, not the plan's — the file grew between the plan's measurement commit (`84b1638e4`) and now; re-grep before editing.

1. **The both-links `*` phase gives no fix command** (`:1072`, inside the `case "$st" in` at `:1058`). `delivered|released|superseded|rejected` arms fix by removing the `active/` link; `draft|approved` arms fix by removing the `delivered/` link. The `*` default — a plan whose phase is `design` or anything else the case doesn't name — only reports the drift and gives no `fix:` line, unlike every other drift arm in this section. Decide what the default case can safely recommend (if anything — a `design` phase may not have an unambiguous answer, in which case say that explicitly rather than silently omitting the line) and emit it.

2. **The both-links arms repeat `emit_drift`'s body by hand** (`:1062-1077`). `emit_drift` (`:1057`) already exists and is used by the two single-link `elif` arms below (`:1079`, `:1086`) — but the both-links `if` block's three `case` arms each write `drift_out+="  $base — phase '$raw_phase' but linked in both $ACTIVE_DIR/ and $DELIVERED_DIR/\n"` and bump `n_drift` by hand instead of calling it. Route all three through `emit_drift`, passing the fix source/dest pair where one exists (none for `*`, per point 1's answer). This is also the shell-line saving the plan calls out: three duplicated lines collapse to three `emit_drift` calls.

3. **Section 7's code contradicts its own comment on node's start cost** (`:1509` comment, `:1520-1532` code). The comment above the section (`docs/shell-and-domain.md: once per reconcile pass`) says `plot-slice-chain.mjs` is invoked once per pass. The code starts a fresh `node` process inside the `while IFS="$US" read` loop (`:1531`), i.e. once per multi-branch wave found — not once per pass. Either make the code match the comment (batch all wave records into one `node` invocation, e.g. one JSON array piped once) or make the comment match the code (say "once per multi-branch wave" and justify why a pass-level batch wasn't worth it). The plan's own cost rule (`docs/shell-and-domain.md`) favors batching for anything that runs more than once per operator command — prefer fixing the code over fixing the comment unless batching turns out to need a second pass over `plan_json`, which the plan does not anticipate.

Also verify (not yet confirmed as broken): the plan lists "one missing-bundle line" as part of this slice's deliverable (section 7's `elif` arm, `:1536`, printing `(not evaluated — board/plot-slice-chain.mjs or node is missing)`). Reading current `main`, that arm already emits exactly one line and the `if/elif` structure doesn't double it. If re-reading confirms it's already correct, say so in the PR rather than changing it — the plan's finding may have been fixed as a side effect of something else, or may be about different wording than what's there now.

### The decisions the plan settles — do not re-derive them

**The count in section 7 comes from `plot-plan-meta.sh`'s `waves[]`, never a second parser.** A backticked branch name in a plan's prose is not a branch line — the parser already draws that distinction (`a-plan-branch-can-be-a-parser-artifact`), and re-deriving it in this slice's fix would reproduce the exact defect that rule exists to prevent. Don't touch the jq extraction at `:1533-1535` beyond what batching requires.

**A CHAIN is not an uncut heading.** `isChainedHeading` (`@plot-pm/domain/rules/slice-chain`), asked through `board/plot-slice-chain.mjs`, decides that — not a second jq/shell implementation. If you batch the node calls, you still call through this one bundle; you don't inline the chain logic.

**Section 7 does not gate.** `unsliced_waves=` stays out of the `attention=` footer counter the delivery gate reads. Don't fold it in while touching this code, even if it looks like an oversight — the plan's placement note (`:1491-1494`) says this is deliberate: an uncut slice is a shape to fix, not a branch that cannot move.

**A fixture must make old and new disagree, mutation-tested against the old code before the PR.** For the `*` phase fix-command finding, the fixture is a plan with both `active/` and `delivered/` links and a phase the case doesn't name (e.g. `design` or a typo'd phase) — the old code reports drift with no `fix:` line; the new code's behavior must differ in a way the test can assert. For the node-per-pass fix, the fixture needs ≥2 plans each with a multi-branch wave — if you batch, the old code calls `node` N times and the new code once; a test can only tell these apart by counting `node` invocations (e.g. stub the bundle path and count calls), not by checking output text, since the output is unchanged either way.

**Comments describe current behaviour, not history.** Per `CLAUDE.md`'s writing rules, don't write "previously this missed X" in a comment you're touching — if you need the history, it goes in the PR description or commit message, not the script.

### Done when

The plan's slice line is the specification: one node start per pass (or an honestly corrected comment), one missing-bundle line (verify, don't assume broken), a fix command for a both-links plan with an unlisted phase. Assertions that exist because a naive implementation would pass without them:

- A both-links plan with phase `design` (or another phase outside the four named) gets a `fix:` line, or the test asserts the slice's documented reason it cannot — catches silently leaving the `*` arm as report-only.
- The three both-links `case` arms produce byte-identical `drift_out` content before and after routing through `emit_drift` — catches a refactor that changes wording while deduplicating.
- If node is batched: a fixture with 2+ multi-branch waves across plans shows exactly one `node` invocation, where the unfixed code shows N — catches a change that only edits the comment.
- If the comment is corrected instead: the comment no longer cites `docs/shell-and-domain.md`'s "once per reconcile pass" rule for a call site that runs once per wave — catches leaving the stale justification in place.

Plus: changeset (package `plot`, description first, `bumps:` block last, a `plan:` line inside the comment block — never as the first line). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`plot-reconcile-scan.sh` is shell under `skills/`: `scripts/check-shell-lines.sh` refuses a pull request whose shell there is longer than at its merge base. Routing the both-links arms through `emit_drift` should net-reduce lines; if the node-per-pass fix adds lines elsewhere, the `emit_drift` savings are your budget for it. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` sections 1 and 7 only (roughly lines 1000-1095 and 1480-1540 on current `main` — re-grep for `emit_drift()` and `== 7\. Uncut slices` before editing, since line numbers drift). It does not touch sections 22-24b, 23, or 24 — those belong to `bug/reconcile-scan-sections-22-24`, which waits on this branch merging first. It does not touch `plot-config.sh` or `plot-plan-meta.sh` (wave 1, already merged) or the corpus/scan test files (also wave 1, already merged). Run `git fetch && git branch -r | grep reconcile` before you push to confirm `-22-24` hasn't started yet; if it has, coordinate rather than both touching the same file concurrently.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
