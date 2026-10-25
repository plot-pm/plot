## Implementation brief — plot-review-loses-an-existing-issue (wave 3: Shell tests)

- **Plan (canonical):** docs/plans/2026-10-24-plot-review-loses-an-existing-issue.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2542 merged
- **Branch:** `bug/plot-host-title-has-has-tests` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CODEOWNERS / PR review)

This is the plan's third and last slice. Both earlier slices are merged:
`bug/plot-review-keeps-an-issue-when-its-comment-fails` → #2567 and
`bug/plot-host-pr-comment-reads-only-the-apps-comments` → #2661. Nothing
waits on this slice, and it waits on nothing — it adds tests and one doc
comment, with no runtime behaviour change.

### What to build

Finding 3 of issue #2488 names three gaps, all still open on `main` as of
this brief:

1. **No shell test exercises `--title-has` in `plot-host.sh`.** The arm at
   `skills/plot/scripts/plot-host.sh:5260-5275` has three paths and zero
   coverage in `test/reconcile/host.test.mjs`: the `gh` search text it builds
   (`--search 'in:title "<text>"'`, ANDed with `--label` rather than
   replacing it), the open-only refusal (`--title-has` with any `--state`
   other than `open` dies with "issue-list: --title-has only works with
   --state open"), and the Bitbucket/Jira exit 4 (both back ends refuse
   `--title-has` outright — Jira at line 5102, Bitbucket at line 5306 — before
   any network call).
2. **`review.ts:227`'s lookup has no comment on search-index lag.** `openIssueOfPr`
   (`packages/board/src/server/entry/review.ts:222-239`) searches the
   tracker's title index to find an existing follow-up issue before opening a
   new one. GitHub's (and Jira's) search index can lag a just-opened issue,
   so a duplicate guard reading it right after opening can still miss the row
   it just wrote. Nothing today says this at the read site; add it as a
   comment on `openIssueOfPr`, not a behaviour change — the plan asks for the
   gap to be named, not closed in this slice.
3. **The 250-row backlog test does its own title filtering.** This one is
   already fixed on `main` — read before writing more tests here. In
   `packages/board/test/unit/review.test.ts:663-682`
   (`'a backlog of 250 labelled issues with the match at row 230 still finds
   it'`), the stub's `issueListWithTitle` filters `haystack` by `titleHas`
   itself (line 673: `haystack.filter((issue) => issue.title.includes(titleHas))`).
   That filter is the fix the earlier slices already shipped — #2567 moved
   the lookup from an unfiltered backlog scan to a title-searched one, and
   the stub was updated to model that. Confirm this by reading the test, not
   by re-deriving it from the plan text, which was written before #2567
   landed and still describes the pre-fix stub.

### Decisions the plan settles — do not re-derive them

**The shell tests go in `test/reconcile/host.test.mjs`, not a new file.**
Every other `issue-list` arm (github derive-status, github asked-fields,
bitbucket contract, bitbucket exit-4 cases) already lives there in one block
starting at line 2023. A fourth file for one more arm of the same op would
split one op's coverage across files for no reason the existing tests don't
already reject — `makeStubs`/`argvOf`/`ghArgv` are already set up in this
file and nowhere else.

**Assert the `gh --search` string via `argvOf(stubs.ghArgv)`, the pattern
every other github arm in this file already uses** (e.g. line 2050-2052,
line 2064-2066) — not a fresh argv-parsing helper. `makeStubs({ ghJson })`
takes the JSON `gh` should answer; the test asserts on the recorded argv
file, never on a real `gh` call reaching anywhere.

**The open-only refusal and the two exit-4 arms need no `gh`/`bb` stub at
all.** Both die before any process spawn — the open-only check is a bash
`[ -z "$title_has" ] || [ "$gh_state" = open ] || die …` at line 5264, and
the Jira/Bitbucket refusals are the same shape at lines 5102 and 5306. A
test asserting on `res.status` and `res.stderr` with `PLOT_HOST` set to each
backend, no stub installed, proves the exit happens before any spend — the
same shape `host.test.mjs` already uses for the Jira/Bitbucket
closed-or-changed refusals a few hundred lines up.

**Do not touch `review.ts`'s runtime behaviour.** The plan's Design section
settled runtime questions in slices 1 and 2 (keep the issue record on a
failed comment, name an unaskable comment in the status, scope the marker
lookup to the App's own login). This slice is tests plus one doc comment —
adding a behaviour change here would be scope creep past what #2488's
finding 3 asks for.

### Done when

The plan's `## Done when` is implicit in its Slices section rather than a
separate list — read the Design section's three bullets as the
specification. For this slice specifically:

- A test proves the `gh` search text is `in:title "PR #<n>"` when
  `--title-has 'PR #<n>'` is passed, and that `--label` still rides along in
  the same call (finding 1's "title search narrows, it does not replace the
  label filter", `plot-host.sh:5269-5271`).
- A test proves `--title-has` with `--state closed` (or any non-open state)
  on GitHub dies with the documented message and never calls `gh` — assert
  no `ghArgv` file was written, not just a non-zero exit, so a refusal that
  slipped past the guard and failed inside `gh` instead doesn't pass by
  accident.
- A test proves `--title-has` on Jira and on Bitbucket each exit 4 with no
  stub installed — proving zero spend, the same invariant the plan's Notes
  section already holds for every exit-4 arm in this file.
- The new comment on `openIssueOfPr` names the search-index lag and what it
  does to the duplicate guard — a reader should come away knowing a
  just-reopened duplicate finding is a known, named risk, not a surprise.

Plus: a changeset describing the test and doc additions (patch-level — no
behaviour change ships), and `scripts/check-shell-lines.sh` — this slice adds
shell-test code under `skills/`'s accounting only if the new tests live in a
`.sh` file; they don't (the target is `test/reconcile/host.test.mjs`, a
`.test.mjs`), so the shell-line ratchet does not apply to this slice's
primary work. Run `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — it resolves to the tests and
typecheck for the files you actually touched. The suites in `## Plot Config`
→ `CI suites` run in CI on every PR; don't run the full `test:e2e` locally
(see `CLAUDE.md` Testing section — it dispatches real workers and is CI's
gate, not a local one).

### Bookkeeping

Open the PR through the controller once the branch exists and carries a
commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly — it takes its title from the last commit
subject rather than the plan's wave heading, and the plan would then show no
`→ #<number>` annotation for this slice. Push the first real commit as soon
as it exists, so the branch is visible to `/plot-pulse` while in flight. When
the PR is created, append `→ #<number>` to this branch's line under
`docs/plans/2026-10-24-plot-review-loses-an-existing-issue.md`'s
`### Shell tests` heading.

### Scope guard

This branch owns:

- `test/reconcile/host.test.mjs` — new tests only, appended near the
  existing `issue-list` block (around line 2023-2110)
- `packages/board/src/server/entry/review.ts` — one new comment on
  `openIssueOfPr`, no code change
- a new changeset under `.changeset/`

No other branch of this plan is in flight — both prior slices merged. There
is no collision to track.

If you find something #2488 did not anticipate, report it rather than
improvising outside scope.
