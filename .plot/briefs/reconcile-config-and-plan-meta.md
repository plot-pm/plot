## Implementation brief — reconcile-scan-sections-7-20-24 (wave 1: Fixes that touch no scan code)

- **Plan (canonical):** `docs/plans/2026-10-24-reconcile-scan-sections-7-20-24.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2506 merged
- **Branch:** `bug/reconcile-config-and-plan-meta` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 holds two branches that touch no scan code and run in parallel: this one and `bug/reconcile-corpus-and-scan-tests`. Wave 2 (`bug/reconcile-scan-sections-1-and-7`, then `-22-24`) waits on both. This branch owns `plot-config.sh` and `plot-plan-meta.sh`; the other wave 1 branch owns tests only.

### What to build

Three findings from issue #2479, all in two helper scripts:

1. **`plot-config.sh get-raw` keeps prose after a backticked value** (`plot-config.sh:269`). `get-raw` sets `prose='s/`//g;'`, so a config line written as ``- **Shipped code paths:** `^(packages/[^/]+/src/|skills/)` (the code a plan ships)`` returns the regex followed by the prose. `plot-reconcile-scan.sh:2849` feeds that string to `grep -E`, so the Shipped code paths check in section 22 matches no path and reports clean on every plan. Make `get-raw` return only the first backtick span when the value starts with one, and keep today's behaviour (strip backticks only) for a value with no backtick span.
2. **A bare deferral marker erases the heading's reason** (`plot-plan-meta.sh:996`). In overlay mode `keep_branch` runs `if (!overlay || is_deferred) { deferred_why[n] = defer_note }`. A list item with `<!-- deferred -->` and no reason sets `is_deferred` and overwrites the reason the heading wrote with the empty `defer_note`. In overlay mode, write `deferred_why[n]` only when `defer_note != ""`; the flag still sets to `true`.
3. **Overlay mode repeats commit refs** (`plot-plan-meta.sh:1012`). `commits_of[n]` appends the list item's commits to the heading's without checking for a ref both carry, so a ref named on both lines is emitted twice. De-duplicate while preserving first-seen order.

Also in scope: the LOW finding at `plot-config.sh:269` that unrelated scripts were compressed into one-liners to pay the shell-line gate. Restore them only if the net line count still passes `scripts/check-shell-lines.sh`; otherwise record the trade in the plan's Notes. Line 269 is itself the compressed `case` one-liner.

### The decisions the plan settles — do not re-derive them

**`get-raw` has exactly one caller.** `grep -rIn get-raw skills scripts test packages` finds `plot-reconcile-scan.sh:2849` as the only call; `skills/plot/SKILL.md:55` and the `plot-config.sh` header comments only document it. The plan's open question ("does any other caller rely on the prose staying?") therefore answers no for code in this repo. Re-run the grep before you change it, and say the result in the PR.

**Do not change `get`.** `get` strips `(...)` as prose by design, so a multi-value list reads whole. The fix is scoped to the `get-raw` arm. `test/reconcile/config.test.mjs:116` (`get-raw keeps a regex value whole, get still strips prose`) already asserts `^(backend/.*/src/main/|frontend/)` and `^src/[a-z]{1,3}/(x|y)` survive. Both must still pass unchanged: a fix that cuts at the first `(` would break them, and a fix that strips everything after the first backtick pair would break a value with no backticks.

**A fixture must make old and new disagree.** Plan rule: each message or count fix ships with a test whose fixture makes the two behaviours differ, mutation-tested against the old code before the PR. For `get-raw` the fixture is a backticked regex followed by prose; the old code returns the prose too. For the deferral reason, the fixture is a heading with `<!-- deferred: reason -->` and a list item with bare `<!-- deferred -->`; the old code emits an empty reason. For commits, the fixture names the same ref on the heading and the item; the old code emits it twice. A fixture where the heading carries no reason, or the refs differ, passes under both and proves nothing.

**Invariants this repo keeps re-learning.** A bare `<!-- deferred -->` is still deferred (the flag stays `true`; only the reason is preserved). An absent reason is not an empty reason — a different statement from a reason of `""`, per the existing comment at `plot-plan-meta.sh:988`. Non-overlay mode keeps its current behaviour: `if (!overlay || ...)` still overwrites. Rewrite comments you touch to state current behaviour, not history ("it matched `deferred:` only", "the parser now hears it" are history).

**Board impact.** `plot-plan-meta.sh` feeds the board. Run the board's plan-parsing tests (below) for this slice.

### Done when

The plan's slice line is the specification: fix `get-raw` and the two `plot-plan-meta.sh` findings. Assertions that exist because a naive implementation would pass without them:

- `get-raw` on a backticked value followed by prose returns only the backtick content — catches a fix that only strips backticks (the status quo).
- `get-raw` still returns a no-backtick value whole, and the two existing `config.test.mjs` regex assertions still pass — catches a cut-at-first-`(` fix.
- A bare list-item marker leaves the heading's `deferred_reason` intact AND `deferred` stays `true` — catches a fix that skips the whole assignment.
- A ref named on heading and item appears once, in first-seen order — catches a sort-and-uniq that reorders.
- `plot-reconcile-scan.sh` section 22's Shipped code paths check reads its pattern when the config line carries trailing prose — one end-to-end assertion that the check no longer matches nothing. The scan file is wave 2's; add the test in `test/reconcile/` and edit no scan code.

Plus: changeset (package `plot`, description first, `bumps:` block last, `plan:` line inside the comment block, never first). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Both scripts under `skills/` are shell: `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, so growth is paid for in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Net-zero or negative lines is the target; the awk edits above should each fit in the lines they replace.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-config.sh`, `skills/plot/scripts/plot-plan-meta.sh`, `test/reconcile/config.test.mjs` and a plan-meta test, plus the changeset. Sibling `bug/reconcile-corpus-and-scan-tests` owns `packages/domain/corpus/*.corpus.test.ts` and `test/reconcile/scan-double-link.test.mjs`. Wave 2 owns `plot-reconcile-scan.sh` and `skills/plot-reconcile/SKILL.md`: edit neither. Verify with `git fetch` and `git branch -r | grep reconcile` before you push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
