## Implementation brief — delivery-reads-the-delivered-plan-and (wave 2: Scan source)

- **Plan (canonical):** `docs/plans/2026-10-17-delivery-reads-the-delivered-plan-and.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1971 merged
- **Branch:** `bug/scan-reads-plans-at-the-fetched-ref` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 (`bug/deliver-ref-read-canonical-path`) and wave 3 (`bug/default-branch-writes-take-turns`) are independent of this one. The plan's open question 3 asks whether this wave reuses wave 1's ref-path fix; decide and record the answer in the plan before changing code (see below).

### What to build

`plot-reconcile-scan.sh` enumerates plans from the **working tree**, not from what was just pushed. Line 594 globs `"$PLAN_DIR"/[0-9]*.md` on disk, and line 601 hands that file list straight to `plot-plan-meta.sh`, which just `cat`s whatever path it is given — it has no notion of a ref. `plot-deliver.sh` pushes a plan's `Delivered:` record through `plot-push-main.sh` and leaves the **local checkout** one commit behind (it does not fast-forward). So the first reconcile scan run after a delivery globs the pre-delivery copy of the plan file and reports `merged_not_delivered=1` for a plan that, on `origin/<default>`, already carries `State: Delivered`. Observed twice on 2026-10-06 (Bitbucket, default branch `develop`). Issue #1340.

Fix it the way the dispatch phase gate already fixes the same class of bug: read the plan content from `origin/<default>`, not the working tree. `plot-dispatch.sh`'s phase gate (`:2822-2829`) asks "has this plan been approved WHERE EVERYONE CAN SEE IT?" via `git show origin/<main>:<path>` with deliberately no working-tree fallback — the comment there names the exact two-directional bug (wrongly refuse, wrongly permit) that reading local state produces. This slice is that same fix applied to the reconcile scan's plan enumeration.

### Decisions the plan settles — do not re-derive them

**Of the plan's three named options, the ref read is the one to build.** The plan's Design section lists three: (a) scan reads from `origin/<default>` via `git show`, (b) `plot-deliver.sh` fast-forwards the local default branch after a clean push, (c) step 7b runs `git pull --ff-only` first. The plan itself already narrows this: "(a) is the only one that does not depend on the checkout being on the default branch." (b) and (c) only help when the scan's checkout *is* the default branch — a desk's worktree, a detached scratch checkout, or a CI runner checked out on a PR branch all run the scan while sitting somewhere else entirely, and both of those fixes are silent no-ops there. (a) fixes the read regardless of what the checkout is parked on.

**Open question 1 ("which of the three fixes?") is therefore answered by the plan's own text, not reopened here.** What is still open, per the plan, is the *cost* of reading every plan via `git show` instead of a filesystem glob — measure it against the scan's CPU budget (see `measure-plot-scan-by-cpu-not-wall-clock.md` in memory: wall-clock on this machine is noisy under concurrent agents; CPU time is the comparable number) before committing to the change, and record the measurement in the plan's Open Questions before merging.

**Open question 3 (share the ref-read code with wave 1?) — decide, don't guess.** Wave 1 fixes `phaseAtRef` in `packages/board/src/server/deliver.ts` (TypeScript, board package, reads one plan file at a known ref). This slice is a **shell script** reading potentially every plan file in `docs/plans/` in one pass. They solve the same class of problem (read at a pushed ref, not the working tree) but in different languages and different cardinalities — there is no code to literally share across the shell/TypeScript boundary. Record in the plan that the fixes are parallel rather than shared, with the reason (language and cardinality differ), rather than leaving the question unanswered.

**The merged-PR list in this same script is already the right shape to imitate.** Lines 613-650 document the fetched-ref precedent for PR state (index first, host for what it can't answer, only a MERGED row is taken because it cannot revert) — read that comment block before writing the plan-enumeration fix; it's the local convention for "answer from a fetched/pushed source, never from what's on disk."

**`git show origin/<default>:<path>` needs a path list, and the working tree still supplies that list.** You cannot `ls` a ref for files matching a glob without an extra `git ls-tree` call per plan directory — decide whether to glob the working tree for *which* files exist (cheap, and a file's existence rarely lags by more than a delivery) and then read each one's *content* from `origin/<default>` (the part that actually goes stale), or to `git ls-tree origin/<default> -- "$PLAN_DIR"` for the file list too. The plan's own test (below) only exercises content staleness, which suggests the former, but name whichever you pick and why in the PR description — this is exactly the kind of judgment call CLAUDE.md's "A Decision Reads The Index" section asks you to make deliberately rather than by default.

**Absence is not false, same as wave 1's rule.** If `git show origin/<default>:<path>` fails (file didn't exist at that ref, path moved, whatever), that is "cannot read," never "plan doesn't exist" or "plan is pre-delivery." Don't let a read failure manufacture a false `merged_not_delivered` in the other direction.

### Done when

The plan's slice line for this branch is the specification: **the delivery-landed gate reads the delivered plan, with the test and the `SKILL.md` correction.** Two assertions exist because a naive fix would pass without them:

- **The plan's own test:** deliver on a checkout on the default branch, run the scan **without pulling first**, and assert the plan is absent above the blocking-sections marker (i.e., no `merged_not_delivered` finding for it). This is the fixture that reproduces #1340 — write it first and watch it fail against the current code.
- **A plan still on a feature branch (never pushed to `origin/<default>` at all) must still be read correctly** — don't let the ref-read fix regress the ordinary case of scanning an in-progress plan that the working tree sees but `origin/<default>` has never carried. The scan's existing non-delivery sections (active-plan drift, stale branches, etc.) still need the working-tree's view of in-flight plans; only the delivered-plan content needs to come from the ref.

Also in this slice: correct `skills/plot-deliver/SKILL.md:487`, which currently instructs the reader to run the scan and treat its output as authoritative for "did this just land" without noting that the scan used to need a prior fetch/pull to be correct. Once the ref read lands, that caveat is no longer true — say so, don't just delete the old wrong text silently (a reader diffing the skill should be able to see what changed and why).

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally — it is CI's gate, not a local one. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base — this slice touches `plot-reconcile-scan.sh`, so if the fix adds lines, remove an equal number elsewhere in the same change, or push the new logic into a bundle the script calls through instead of inline. A PR must carry no generated bundle (`scripts/check-no-bundle-diff.sh`); do not commit `board-server.mjs`.

Write a changeset: description first (one line, what changed), `bumps:` block last, package `plot` (this is a `skills/` shell change, not `@plot-pm/board`), patch — this is a bug fix with no new user-facing surface.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `skills/plot/scripts/plot-reconcile-scan.sh`, `skills/plot-deliver/SKILL.md` (the `:487` correction only), the new reconcile test fixture(s) under `test/reconcile/`, one new `.changeset/*.md`. Do not touch `packages/board/src/server/deliver.ts` or `deliver-route.test.ts` (wave 1), nor `plot-push-main.sh` or the approve/release routes (wave 3).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
