## Implementation brief — bitbucket-pr-rows-run-per-row (wave 4: Tests and wording)

- **Plan (canonical):** docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2514 merged
- **Branch:** `bug/bitbucket-bind-coverage-and-docs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This branch waits on `bug/pr-refresh-rotation-keeps-green` (PR #2634). That
merged 2026-10-24 — confirmed via `plot-host.sh pr-state 2546/2617/2634`, all
three prior-wave branches read `MERGED`. This slice is eligible now. Its
sibling in the same wave, `docs/one-pr-reader-plan-figures`, touches a
different plan file and does not overlap.

### What to build

Four tests the plan names as missing, plus corrections to LOW-severity doc
and code defects — all against `origin/main` as it stands today, not the
`84b1638e4` snapshot the plan was written from. **Re-check every finding
below against current `main` before touching it**: three of the plan's named
LOW findings are already fixed by the three merged predecessor slices, and
one test file named by line number has since been rewritten from
`node --test` to `vitest` with different exports. Fixing an already-fixed
line, or editing a symbol that no longer exists, is wasted motion this brief
exists to prevent.

### Decisions already settled — do not re-derive them

**Three of nineteen LOW findings are stale; verify before you touch them.**
Reading `origin/main` at HEAD during this brief's preparation:

- `packages/domain/src/entities/pr-index.ts:96` already types `checksLookup`
  as `z.enum(['skipped', 'broken'])`, not `any string`. The finding predates
  slice 2 (`bug/bitbucket-checks-lookups-bounded`, PR #2617), which introduced
  the literal type when it added the `broken` outcome. **No change needed.**
- `packages/domain/src/rules/bitbucket-mergeable.ts:44` already reads
  `merge-tree --write-tree` reads the object database only; it writes
  neither" — the "writes tree and blob objects" wording the plan quotes is
  gone. **No change needed.**
- `packages/domain/src/rules/pr-index.ts:290-291` already reads "A draft row
  is re-asked like any other open row; it rides the same `pr-list` call, so a
  draft adds a number to the question and no request" — this already
  contradicts the OLD claim the plan flags ("a draft adds no request") and
  already sits correctly relative to the preceding `@param held`. **No change
  needed.**

**`packages/domain/test/jenkins-pr-checks.test.ts` was rewritten since the
plan's source commit.** It is 157 lines of `vitest` (`describe`/`it`/
`expect`) importing `rowsToBind` and `bindChecks` from
`../src/rules/jenkins-pr-checks.js` — not the `node --test` file the plan's
`:106` reference and `droppedBranches`/`boundBranches` symbols describe.
`grep -rn "droppedBranches|boundBranches"` across the repo returns nothing.
**Treat this finding as moot** — the tautological assertion it names does not
exist in the current file. Confirm no equivalent tautology exists in the
current 157 lines (skim it; it's short) rather than hunting for a line number
that no longer applies.

**One LOW finding is still open and is the one with real test content to
write.** `test/reconcile/bitbucket-mergeable.test.mjs`'s MERGED-rows test
(`host: MERGED rows keep mergeable unknown and run no git merge-tree call`,
around line 340) asserts `gitStatus(sandbox.workDir)` is unchanged before and
after — a working-tree/index check, not a call-count check. It does not
prove `merge-tree` itself was never invoked. A neighboring test two tests
below it (`host: the fold charges no extra bb call`) counts **bb** stub
calls via `bbCallCount`, and a third test in `test/reconcile/host.test.mjs`
(`host: a MERGED row makes zero git calls`) counts git calls for a
differently-shaped fixture — but neither is the MERGED-rows test the plan
names. Give the named test its own git-call counter (mirror the stubbing
pattern `makeCountingBbStub`/`bbCallCount` already use, or add an equivalent
counting wrapper around `git` if the repo's git-stub helpers differ) so it
positively asserts zero `merge-tree` invocations rather than inferring it
from an unrelated test elsewhere in the same file.

**`--bound-shas` wiring already has an end-to-end path; the plan asks you to
prove it, not build it.** The chain is real and traceable right now:
`packages/fleet/src/shared/pr-refresh.ts:1489-1493` builds `boundShas` from
every OPEN row's `checksSha` and appends `--bound-shas <json>` to the
refresh's own argv; `plot-host.sh:4374` parses that flag into `_bound_shas`;
and `jenkins_bind_rows` (`plot-host.sh:1992`) takes it as its fifth
positional argument, forwarding it to `plot-jenkins-pr-checks.mjs rows`. Write
the test as a trace through this exact chain — a row with a `checksSha`
matching its current head should come back last/unbound per the rotation
rule (`packages/domain/src/rules/jenkins-pr-checks.ts`'s `rowsToBind` ROTATION
doc comment, just above `SHA_LOOKUPS_PER_PASS`'s use), not first/reasked.

**The `$wasNamed`-with-a-broken-ask arm already exists in the jq chain, in
both `pr-state` and the Bitbucket bind.** `plot-host.sh:4591` (pr-state path)
and `:4771` (pr-list/bind path) both compute `$wasNamed` and branch on it —
these are the current line numbers, not the plan's `:4607` (the file has
grown since the plan's source commit; always re-grep rather than trusting a
plan's line reference). `test/reconcile/host.test.mjs` already has partial
coverage near `:3337`/`:3358` asserting `checksLookup === 'broken'` for a
named-but-failed-ask row — check whether that coverage already satisfies the
plan's ask (a `$wasNamed` row with a broken ask, across several states under
`--state all`) before writing a new test; `--state all` cap/scope tests
already exist at `:1631`, `:1700`, `:3258`, `:3298`. If the existing tests
already cover the shape, say so in the PR rather than duplicating them —
duplicated coverage is not the same defect as missing coverage.

**Line numbers throughout the plan are stamped from commit `84b1638e4`, dated
2026-10-24, and `main` has moved since** (three merges landed, plus unrelated
work). Treat every `file:line` reference in the plan's Motivation and Slices
sections as approximate; re-locate by content (grep the quoted wording or
symbol name) before editing, the same way this brief's own verification did.

### Done when

The plan's `## Done when` list doesn't exist as a separate section — the
plan states its scope directly in Slice 4's one-line description: tests for
`--bound-shas` wiring, several states, a broken ask, and a real `merge-tree`
count; corrections to the LOW findings. Treat each LOW-finding bullet under
"Tests and wording" in the plan as a checklist item, with "already fixed,
verified, no change" as a valid, equally complete outcome for three of them
and the `droppedBranches` one.

Plus: a changeset (`plot: patch` at minimum — this is a bug-fix branch) and
`scripts/check-shell-lines.sh`'s ratchet if you touch `plot-host.sh` — any
shell growth there must be paid for by removing shell elsewhere in the same
PR, or by moving logic into `plot-jenkins-pr-checks.mjs`/the domain instead.
Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints; the suites in the `CI suites` config key run in CI
only — do not run them locally as a matter of course.

### Bookkeeping

Open the PR through the controller once there's a real commit:
`skills/plot/scripts/plot-open-pr.sh` (or `--draft` while work is still
moving). Do not use `gh pr create`. When the PR exists, append
`→ #<number>` to this branch's line under the plan's `## Slices` →
"Tests and wording" heading.

### Scope guard

This branch owns: `test/reconcile/bitbucket-mergeable.test.mjs`,
`test/reconcile/host.test.mjs`, `packages/domain/test/jenkins-pr-checks.test.ts`,
and the doc/comment corrections in `packages/board/src/contract/schema.ts`,
`packages/board/src/server/entry/jenkins-pr-checks.ts`,
`packages/domain/src/entities/pr-index.ts` (verify-only, likely no-op),
`packages/domain/src/rules/bitbucket-mergeable.ts` (verify-only, likely
no-op), `packages/domain/src/rules/pr-index.ts` (verify-only, likely no-op),
`skills/plot/scripts/README.md`, and `skills/plot/scripts/plot-host.sh`
(comments only, per the two remaining LOW findings about the
`jenkins_bind_rows` comment and the long jq lines).

This branch's only sibling in the wave, `docs/one-pr-reader-plan-figures`,
edits a different plan file entirely (`one-pr-reader-per-machine-and`) and
has no file overlap with this branch. The three prior-wave branches
(`bug/bitbucket-mergeable-fold-open-rows`, `bug/bitbucket-checks-lookups-bounded`,
`bug/pr-refresh-rotation-keeps-green`) are already merged into `main`, so
their changes are part of this branch's base — nothing to coordinate with.

If you find a LOW finding the plan names that, on inspection, is neither
fixed nor matches current code at all (symbol renamed, file moved), report
it in the PR rather than guessing at the plan author's intent.
