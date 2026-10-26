## Implementation brief — bitbucket-and-github-listings-read-one (wave: Stubs and plan)

- **Plan (canonical):** docs/plans/2026-10-24-bitbucket-and-github-listings-read-one.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2522 merged
- **Branch:** `bug/bitbucket-stubs-and-listing-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr (plan's `Review:` field)

This is the third and last wave of the plan. The other two branches —
`bug/bitbucket-listings-follow-next` (merged as PR #2573) and
`bug/github-open-lookup-asks-per-branch` (merged as PR #2595, see
`705fcf04` "GitHub open lookup (#2595)" on main) — are already done. Nothing
in this wave depends on redoing their work; it only needs the test stubs and
the sibling plan to catch up with what they shipped.

### What to build

Two independent fixes, both in `test/reconcile/host.test.mjs` and in
`docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md` — no production
shell code changes:

1. **`makeBbOnlyStub` (test/reconcile/host.test.mjs:8810) emits invalid bash
   and under-tests the open-PR path.** Read the current function body before
   touching it — it has already moved since the plan's findings were
   measured (plan cites `:8621`/`:8649`; the function is at `:8810` on
   current `main`). Specifically:
   - It builds `mergedQuery` with `encodeURIComponent(...)`
     (`host.test.mjs:8836`), but the real `bb_branch_query` builds its query
     string with `url_encode` (`plot-host.sh:1002`), whose safe set is
     `[a-zA-Z0-9.~_-]` — narrower than `encodeURIComponent`'s. For any branch
     name containing a character in `!'()*` (which `encodeURIComponent`
     leaves unescaped and `url_encode` percent-encodes), the stub's match
     condition disagrees with what `bb_branch_query` actually sends, so the
     stub silently falls through to a different `if` arm than production
     traffic would hit. Make the stub's query-matching use the same
     percent-encoding rules as `url_encode`, not `encodeURIComponent`.
   - Confirm whether the generated bash is actually invalid for some
     input (the plan asserts this at `:8621`/`:8649` against the
     pre-move file) — re-check against the current body before assuming the
     claim still holds literally; if the shell itself parses fine today and
     only the encoding mismatch remains, say so and fix only the real defect.
   - `openRows` is already a parameter of `makeBbOnlyStub` and the
     `openValues` it produces are already wired into the stub's third `bb`
     response arm (`"api "*"/pullrequests"*` with no `MERGED`). What's
     missing is a **caller** that passes `openRows` and a test that asserts
     the Bitbucket open-PR lookup returns `found` for one of those rows —
     today every call site passes only `mergedBranch`
     (`host.test.mjs:8906`, `:8916`). Add that test, exercising whichever
     function now does the per-branch Bitbucket open lookup (the sibling to
     GitHub's `_plot_open_lookup`, shipped in PR #2595 — read that function
     first to match its actual call shape rather than guessing it).

2. **The Approved plan `docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md`
   needs amending**, per this plan's finding (`:33`, `:43`). Read it in full
   first — it is itself Approved and Started (`bug/plot-host-bitbucket-pr-list-reads`),
   so the amendment is a plan-content edit, not a lifecycle action, and must
   not touch its `State:`/`Started:` lines (those are gated —
   `plot-state-gate.sh` refuses a `State:` change from anything but the
   controller that owns it). The three things to fix in its prose:
   - It drops the window's size-based completeness check and the measured
     `pagelen=50` request-count saving of `bb api`, without saying it is
     doing so (plan line ~37, ~62 in that file's own numbering — re-find
     them by content, not by line number, since both plans may have drifted).
   - It states `bb_require_json` gates on a version — verify against
     `plot-host.sh` what `bb_require_json` actually gates on before
     correcting the sentence; don't just delete the claim.
   - It lists `bb_branch_query` and `bb_window_listing` under "the one-page
     assumption" — but `bb_branch_query` already follows `next` as of PR
     #2573 (this plan's first wave). Confirm against current `plot-host.sh`
     whether `bb_window_listing` still holds that assumption, and correct
     the sentence to name only what's still true.
   - This edit goes through that other plan's own branch/PR flow per its
     `Review: pr` field — i.e., a separate commit/PR on
     `bug/plot-host-bitbucket-pr-list-reads` or a new branch targeting it,
     **not** folded silently into this slice's branch. Confirm with the
     plan's `Impl`/`Review` fields which is correct before pushing; if
     unclear, ask rather than guess, since this touches another plan's
     already-Started work.

### Decisions already settled — do not re-derive them

**The stub's line numbers in the plan are stale; don't trust them literally.**
The plan's Motivation section cites `host.test.mjs:8621` and `:8649` for
`makeBbOnlyStub`; on current `main` the function starts at `:8810`. Other
commits (the two merged sibling slices) have already shifted line numbers in
this file. Locate by function/variable name (`makeBbOnlyStub`, `mergedQuery`,
`openRows`), never by the plan's cited line number.

**`openRows` already exists as a stub parameter — the gap is test coverage,
not plumbing.** Don't re-design the stub's parameter shape; it was already
built in anticipation of this test and just never got a caller that uses it
non-trivially.

**Why `encodeURIComponent` vs `url_encode` matters and is not cosmetic.**
`url_encode`'s safe set is RFC 3986 "unreserved" characters only
(`[a-zA-Z0-9.~_-]`); `encodeURIComponent` additionally leaves
`! ' ( ) *` unescaped. A branch name with any of those five characters
produces a query string from the stub that does not match what
`bb_branch_query` sends in production, so a test built on the mismatched
stub can pass while the real code's query-building is still broken for that
character class — the exact kind of test/prod divergence this plan's whole
motivation is about avoiding elsewhere.

**Absence is not false — read exit codes, not emptiness**, carried over from
every other Bitbucket-arm plan in this estate: a stub returning `{"values":[]}`
for "no open PRs" must be distinguished from the stub being asked a query it
doesn't recognize at all (which falls through to the `echo "unexpected bb
call"` / `exit 9` arm). When adding the open-row test, assert on the actual
`found`/`none`/`unaskable`-shaped result the lookup function returns, not
just that the stub didn't error.

### Done when

The plan's `## Done when` section is not present as a literal list in this
plan — the Design's Approach steps 4–5 are the specification for this slice:
"The Bitbucket stubs produce valid bash for every option and encode branch
names as `url_encode` does. A test covers the Bitbucket open lookup returning
`found`." and "The Approved plan `plot-host-bitbucket-pr-list-reads` is
amended: it keeps the window's completeness check and the `pagelen=50`
saving, or states why it drops them, and its three inaccurate statements are
corrected."

Concretely:
- `makeBbOnlyStub`'s generated bash parses and its query-matching uses the
  same percent-encoding as `url_encode`, verified against a branch name
  containing at least one of `! ' ( ) *`.
- A new test exercises the Bitbucket open-PR lookup via `openRows` and
  asserts a `found` result for a row that matches.
- `docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md`'s prose no
  longer silently drops the completeness check/pagelen saving, correctly
  describes what `bb_require_json` gates on, and names only the functions
  that still hold the one-page assumption — pushed through that plan's own
  branch/PR, not this slice's.
- No change to `plot-host.sh` or `plot-pr-merged.sh` production code — this
  slice is tests and plan prose only, per the plan's Design ("every change
  stays in `plot-host.sh`, `plot-pr-merged.sh` and the host adapter" refers
  to waves 1–2; this wave's own Approach step 4–5 scope it to stubs and the
  sibling plan).

Also run `node skills/plot/scripts/board/plot-local-checks.mjs` before each
push and run what it prints — it will select `test/reconcile/*.test.mjs` for
any change under `test/reconcile/`. List no full suite beyond what it
prints; `test:e2e` is CI's gate, not a local one.

`scripts/check-shell-lines.sh` only matters if this slice touches a `.sh`
file under `skills/` — it shouldn't, since the fix is in the `.test.mjs`
stub and in plan prose. If a `.sh` edit turns out to be unavoidable, say so
and read that gate's growth rule before pushing.

### Bookkeeping

Open the PR through the controller once there's a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. When the PR exists, append `→ #<number>`
to this branch's line under the plan's `## Slices` → `### Stubs and plan`
heading (`docs/plans/2026-10-24-bitbucket-and-github-listings-read-one.md:66`),
and push the first real commit as soon as it exists.

### Scope guard

This branch owns: `test/reconcile/host.test.mjs` (the `makeBbOnlyStub`
function and its new test), and
`docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md` (prose-only
amendment, routed through that plan's own branch per its `Review: pr`
field — confirm before pushing there directly from this branch).

The other two slices of this plan are already merged (`bug/bitbucket-listings-follow-next`
→ #2573, `bug/github-open-lookup-asks-per-branch` → #2595) and touched
`plot-host.sh` and `plot-pr-merged.sh` — this branch should not need to touch
either file. If it turns out it does, that's scope creep worth reporting
rather than absorbing silently, since those files were this plan's other
waves' territory and are now settled.

If you find something the plan did not anticipate — e.g. the stub's bash is
already valid and only the encoding mismatch remains, or the cited plan line
numbers in the amendment target no longer say what this plan's Motivation
claims — report it rather than improvising outside scope.
