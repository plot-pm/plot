## Implementation brief — the-main-checkout-write-gate-misses (wave 2: Writers)

- **Plan (canonical):** docs/plans/2026-10-24-the-main-checkout-write-gate-misses.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2540 merged
- **Branch:** `bug/the-main-checkout-writers-test-asserts` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `Review: pr` — plot-review on the PR, per repo convention

This wave follows `Gate` (`bug/the-main-checkout-write-gate-misses`), which is merged (#2579): the scanner now sees a git call behind `if`/`for`/`{`/`!`/`time`/`&`, covers `tag`/`fetch src:dst`/`notes`/`clean -f`, skips heredoc bodies, and the continuation launch clears `PLOT_MAIN_CHECKOUT_WRITER`. This branch is eligible now.

### What to build

Issue #2487's third group, checked against `origin/main` at `84b1638e4`: the writers test's assertions don't prove what its comments claim, and a sibling plan's candidate list is stale. Two independent fixes, one branch:

**1. `test/reconcile/main-checkout-writers.test.mjs` — tighten four assertions.**

Current file is 190 lines. Read it in full before editing; its own header (`:1-9`) states the two-half contract (`git status --porcelain` empty + `git diff HEAD --quiet`) that every candidate test already follows — that part is sound and untouched.

- `:189`, `assert.match(text, /plot-host\.sh.*pr-create/, ...)` — this regex matches inside a `//` comment line too, so a script that only *mentions* `plot-host.sh pr-create` in a comment (with the real call removed) still passes. Strip comment lines from `text` before asserting, or anchor the match to a non-comment context.
- same test, `:188`'s `doesNotMatch(text, /git reset|git commit|update-ref|branch -f/, ...)` — misses `git -C <dir> commit` because the pattern requires `git commit` adjacent; a call like `git -C "$tmpwt" commit` (the exact shape `plot-dispatch.sh`'s own booking code uses, and the shape `plot-record-pr.sh`'s bundle now uses too) would slip through if `plot-open-pr.sh` ever grew one. Match `git\b.*\bcommit\b` or similar so a flag between `git` and `commit` doesn't hide it.
- `:1-9` header comment says "BOTH HALVES ARE ASSERTED FOR EVERY CANDIDATE... each runs against a sandbox" — true for the HEAD-mover tests (`makeEstate` + `assertCleanAndConsistent`), but the two `ladder.ts`/`plot-dispatch.sh` tests at `:155-178` assert only against the *source text* (`fs.readFileSync` + regex), no sandbox, no `assertCleanAndConsistent` call. Narrow the header's claim to name which tests run against a sandbox and which are source-text assertions with a cited external proof (the `ladder.ts` one cites `ladder-real-repo.test.ts` in its own comment already) — the claim must match what the test body does, not restate the plan.
- `:81`, `fs.readdirSync(scripts).filter((f) => f.endsWith('.sh'))` — reads only the top level of `skills/plot/scripts/`, so a scratch-file write inside `skills/plot/scripts/board/*.sh` (if one existed) is invisible. Also the `isAtomicRewrite` exemption (`window` = current line + next 3) passes if `mv` appears *anywhere* in that window, including inside an unrelated comment or a different variable's rewrite — tighten it to require the `mv` target the same scratch path, or narrow the window. Walk `fs.readdirSync(scripts, { recursive: true })` (Node 20+, this repo pins Node 24) filtered to `.sh`, or glob nested scripts explicitly.

**2. `docs/plans/2026-10-23-recording-a-slice-pr-number-writes.md` step 4 — correct the candidate list.**

This plan is **Delivered** (`State: Delivered`, `:7`). Editing step 4 of its `## Design` → `### Approach` list changes no `State:` line, so `plot-state-gate.sh` does not apply — confirmed by the plan's own Open Question #4, now answered: no.

- `:34` reads: "Candidates are the PR append in `plot-open-pr.sh`, the board's `record-pr` path, and fleetd." Two of these are already ruled out by this plan's own shipped fix (#2468, `plot-record-pr.sh`) and by the Writers test above: `plot-open-pr.sh` never did the append (confirmed by the `main-checkout-writers.test.mjs` test at `:180-189`, which asserts it has no local git writes at all), and no evidence names fleetd. Remove both from the sentence.
- Add the desk agent as a candidate: the actual writer was the dispatched agent's own worktree session, instructed by `.plot/worker-prompt.sh`'s prose (pre-#2468) to append the PR number to the plan file and commit "from elsewhere" — splitting the write from the commit across two trees. That is what #2468 fixed by moving the whole operation into `plot-record-pr.sh`'s disposable worktree. Name it as the confirmed writer, not a candidate still to be measured — the investigation is over and the fix shipped.
- Name the existing test that proves the fix: `test/reconcile/main-checkout-writers.test.mjs` (added as part of this same cleanup) is the regression guard; cite it in step 4 so a future reader doesn't re-run the investigation this plan already closed.

### Settled — do not re-derive

**`plot-record-pr.sh` and the worker-prompt text are already correct.** Checked `git log -- .plot/worker-prompt.md .plot/worker-prompt.sh`: PR #2468 (merged, commit `b5c1e3489`) already replaced the hand-edit instruction with `skills/plot/scripts/plot-record-pr.sh {branch} <pr-number>` in both `.plot/worker-prompt.md:11` and the duplicate in `.plot/worker-prompt.sh`. The plan's Design step 4 ("Change `.plot/worker-prompt.md` to record a slice PR number through the controller... both files change together") describes work already done before this plan was written — confirmed by comparing the issue's findings (checked against `84b1638e4`) against the current file content. **Do not re-touch either prompt file.** If you find either file still contains hand-edit prose, stop and report — that would mean the fix regressed, which is a bigger finding than this slice's scope.

**The plan being edited (`recording-a-slice-pr-number-writes`) is Delivered, not Approved.** Editing a Delivered plan's Design section is unusual but explicitly sanctioned by this slice's own parent plan (Design step 6) and by the Open Questions' own answer. It is a correction to the historical record, not a reopening of the work — don't add a `State:` line change, don't reorder sections, touch only step 4's prose.

**Rules carried over:** a `State:`-line write needs a receipt from the script that owns it (`plot-approve.sh`/`plot-deliver.sh`/etc.) — this edit writes no such line, so no receipt applies, and this is exactly the boundary the gate (`plot-state-gate.sh`) draws. Arrow functions for any new test helper you write (the domain style rule applies repo-wide to anything you author, even though `test/reconcile/` itself is unconverted legacy). Never commit a generated board bundle.

### Done when

The plan's `## Design` → `### Approach` steps 5 and 6 are the specification. Assertions a naive fix passes without:

- A sandbox fixture where `plot-host.sh`'s mention is a comment and the real `pr-create` call line is deleted: the rewritten test must FAIL. (Proves the comment-line blind spot is actually closed, not just reworded.)
- A `git -C "$dir" commit -m ...` line in a fixture script: the rewritten `doesNotMatch` must catch it.
- The header comment's claim about which tests use a sandbox must be checkable by reading the test bodies alone — no claim should require trusting prose over what `assertCleanAndConsistent`/`makeEstate` calls actually appear.
- A scratch-file candidate nested one directory under `skills/plot/scripts/` (e.g. `skills/plot/scripts/board/leftover.sh`) must be found by the rewritten scratch-writer test.
- Re-reading `recording-a-slice-pr-number-writes.md` step 4 after the edit: it must name exactly one candidate (the desk agent) as the confirmed writer, name zero ruled-out candidates, and cite `main-checkout-writers.test.mjs` by path.

Plus: add a changeset with its `bumps:` block, description first. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, not here. `scripts/check-shell-lines.sh` ratchets shell line count under `skills/` against the merge base — this branch touches no `.sh` file, so it costs nothing against that budget, but double-check if a fix requires editing one.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then run `skills/plot/scripts/plot-record-pr.sh bug/the-main-checkout-writers-test-asserts <pr-number>` to append `→ #<number>` to this branch's line in the plan's `## Slices` section — the controller this very slice is about, used on itself. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `test/reconcile/main-checkout-writers.test.mjs` and `docs/plans/2026-10-23-recording-a-slice-pr-number-writes.md` (step 4 prose only). It does not touch `.plot/worker-prompt.md`, `.plot/worker-prompt.sh`, `packages/domain/src/rules/main-checkout-write.ts`, `packages/board/src/server/entry/gate.ts`, or `packages/fleet/src/shared/continuation.ts` — those belong to the merged `Gate` wave. If a current repo scan shows the prompt files still carry hand-edit prose, or the gate still misses a shell-keyword case, stop and report rather than fixing it here: that is evidence the Gate wave's fix regressed, not this slice's job.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
