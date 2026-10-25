## Implementation brief — reconcile-scan-sections-7-20-24 (wave 1: Fixes that touch no scan code)

- **Plan (canonical):** `docs/plans/2026-10-24-reconcile-scan-sections-7-20-24.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2506 merged
- **Branch:** `bug/reconcile-corpus-and-scan-tests` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 holds two branches that touch no scan code and run in parallel: this one and `bug/reconcile-config-and-plan-meta` (already started). Wave 2 (`bug/reconcile-scan-sections-1-and-7`, then `-22-24`) waits on both. This branch owns four test files — three corpus comparisons and one scan unit test — and edits no production script.

### What to build

Four "tests that cannot fail" findings from issue #2479: each test's fixture currently lets a wrong implementation pass, so the test proves nothing about the behaviour it names.

1. **`branch-state-waits-open-pr.corpus.test.ts` reads a `gh` shim that never models the open draft PR** (lines 46, 61, 154, 156). Read the file before touching it: as of this brief, its `GH` shim (line 43) already answers `OPEN`/`draft: true` for `TARGET` via both `pr view` and `pr list`, and the two `it.each` cases (154) assert `'waiting'` for both the same-heading and cross-heading waiter. If the finding is current against your checkout, the gap is narrower than the issue text — confirm with `git log -p -- packages/domain/corpus/branch-state-waits-open-pr.corpus.test.ts` whether a prior slice already closed it, and say so in the PR rather than silently re-fixing nothing. If a gap remains (e.g. the `--list-eligible` exclusion at line 161 lacks an open-PR-specific assertion, or a mutation test shows the fixture doesn't actually discriminate), close it with a fixture that makes the old shim (no `pr view`/`pr list` match, i.e. `echo "no pull requests found" >&2; exit 1` for every branch) and the new one disagree.
2. **`merge-subject-bitbucket.corpus.test.ts:17`** — the plan cites a prose line inside the file's header comment (the "WHY A DUPLICATE RATHER THAN A CALL" block). Check whether the finding is about the comment describing history rather than current behaviour (the repo's writing rule: comments state current behaviour, not decision history) — if so, this is a wording fix, not a fixture fix. Cross-check against the CASES array (81-115) and the PR-number caveat (27-34) for a comment that no longer matches what the arm does.
3. **`slice-chain.corpus.test.ts:76,98`** — the plan's open question (unresolved, unchecked in the plan's Open Questions) asks whether the fix uses a fixture plan or skips plans that were resliced. Read the comment at line ~95 ("`### Continuation` ... has since been resliced into two single-branch waves — `/plot-reslice` landed while this branch was in flight") — the test already adapted once to a reslice landing under it. The plan's default: pick the fixture unless the corpus has a reason to read live plans. A live-plan corpus test shrinks every time someone reslices the heading it depends on; weigh that against this tier's purpose (comparing against the *real* estate) before changing it, and record the choice in the PR since the plan leaves it open rather than settled.
4. **`scan-double-link.test.mjs:120`** — the section 23 precedence test passes under an always-append regression because `PROJ-999` is not open in the stub. Find the issue-key stub this test's `beforeAll` sets up, add a case where the stub reports `PROJ-999` (or whichever key the always-append regression would wrongly re-append to) as still open, and confirm the test fails against an always-append implementation before fixing the fixture forward.

### The decisions the plan settles — do not re-derive them

**Mutation-test before trusting the fixture, not after.** Plan rule: every message/count fix ships with a test whose fixture makes old and new behaviour disagree, verified by running it against the pre-fix code. For these four files the "fix" often *is* the fixture — there is no behaviour change in production code to pair it with. Confirm each fixture fails under the regression it claims to catch before calling the finding closed.

**This slice edits no scan code.** `plot-reconcile-scan.sh` and `skills/plot-reconcile/SKILL.md` belong to wave 2 (`bug/reconcile-scan-sections-1-and-7` and `-22-24`), which waits on this branch merging first only where the two wave-2 branches edit the same 3000-line file — not on this one. If a test here needs a scan-code change to pass honestly, that is a scope collision to report, not to fix by editing the scan script yourself.

**Corpus tests have their own contract.** `packages/domain/corpus/README.md`: a disagreement between a rule and its shell duplicate stops the branch — adjusting either side to force a pass is the one forbidden move. If investigating finding 1 or 3 surfaces a live rule/shell disagreement (rather than a fixture-only gap), that is a production bug for its own plan, not something this slice's PR absorbs.

**Comments state current behaviour.** Per `CLAUDE.md`'s domain-package rule (applied repo-wide by this plan's Design section): rewrite any comment in these four files that narrates history ("used to...", "per the brief...", "has since been resliced...") rather than stating what the code does now — finding 2 and the slice-chain comment at line ~95 are candidates.

### Done when

The plan's slice line is the specification: "make the corpus and double-link tests reach the code they name." Assertions that exist because a naive implementation would pass without them:

- `branch-state-waits-open-pr.corpus.test.ts`'s fixture fails when run against a `gh` shim that answers no-PR for every branch (proves the open-PR path is actually exercised, not assumed).
- `scan-double-link.test.mjs`'s section-23 precedence test fails against an always-append implementation before your fix, and passes after — catches the exact regression the finding names.
- `slice-chain.corpus.test.ts` keeps passing on `main`'s real estate after you resolve the fixture-vs-live-plan question — a fixture choice that only works until the next reslice is the failure mode the plan's open question is trying to avoid.
- Each comment you touch states current behaviour; grep your diff for "used to", "previously", "has since" before pushing.

Plus: changeset (package `plot`, description first, `bumps:` block last, `plan:` line inside the comment block, never first). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` is not in play unless you end up editing one — if you do, that is itself a scope note worth flagging.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/corpus/branch-state-waits-open-pr.corpus.test.ts`, `packages/domain/corpus/merge-subject-bitbucket.corpus.test.ts`, `packages/domain/corpus/slice-chain.corpus.test.ts`, `test/reconcile/scan-double-link.test.mjs`, plus the changeset. Sibling `bug/reconcile-config-and-plan-meta` owns `plot-config.sh`, `plot-plan-meta.sh` and their tests. Wave 2 owns `plot-reconcile-scan.sh` and `skills/plot-reconcile/SKILL.md`: edit neither. Verify with `git fetch` and `git branch -r | grep reconcile` before you push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
