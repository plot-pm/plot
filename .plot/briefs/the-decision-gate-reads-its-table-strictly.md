## Implementation brief — the-tests-and-gates-close-their-review-findings (wave: Decision table reading)

- **Plan (canonical):** `docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md` on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1495 merged
- **Branch:** `bug/the-decision-gate-reads-its-table-strictly` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR

All four waves above this one — "Group signal after exit", "Board test
signals", "Kill test readiness", "Reaper readings", "Merged heads
answer" — have merged into `main` (the last, `bug/one-answer-to-which-heads-merged`,
as PR #1558). Two waves remain after this one, "Bundle declaration
pairing" and "Gate exit wording"; the plan orders them after this one
because the next wave edits the same file (`scripts/check-decision-count.sh`)
and "Gate exit wording" touches `plot-install-hooks.sh`, disjoint from
this branch.

### What to build

Issue #1412, four findings against `scripts/check-decision-count.sh`:

1. **Kind comparison is case-sensitive.** `rows()` (`:85`) emits the Kind
   cell verbatim; `counted()` (`:176`) and the evidence-change filter in
   `report()` (`:190`) compare it against the lowercase literals
   `launcher`, `readings`, `paired` with `!=`/`==`. A row spelled
   `Launcher` or `Readings` counts as a decision row and, if the count
   rose, fails with "N more than at `<base>`" — a message naming neither
   the row nor the capitalization. Normalize the Kind cell once, in
   `rows()`, with awk's `tolower()`, so every downstream comparison sees
   the lowercased form.
2. **No validation that the Kind cell is one of the four known kinds.**
   Today an arbitrary string in the Kind column silently falls through
   `counted()`'s `!= "launcher"` test (counting it as a decision/orchestration
   row) with no complaint. After case-normalizing, reject any row whose
   Kind is not one of `launcher`, `readings`, `paired`, or the two
   decision/orchestration kinds the table actually spells for everything
   else (`git show HEAD:skills/plot/scripts/README.md` to see the full
   vocabulary — the Kind column is not just these three plus one
   default; read what the table currently contains before assuming a
   closed set of five). Name the row and the offending Kind in the
   failure.
3. **`rows()` never checks cell count against the header.** It reads
   Kind, Runs, Replaced by positionally from the end (`$(NF-3)`, kept
   name for Kind, Runs unused by this gate, `$(NF-1)` for Replaced by).
   A row with one fewer or one extra `|`-delimited cell than the header
   shifts which physical column lands in `NF-3`, so a Purpose cell or a
   Runs cell can be misread as Kind with no error. Count the header's
   cells once (first table line matching `/^\| *Script *\|.*\| *Kind *\|/`)
   and refuse — naming the row — any data row whose cell count differs.
4. **`push` mode's missing-`before`-SHA message is wrong when the SHA
   really is a commit, just absent from this clone.** `:220` fails with
   "is not a commit in this clone" purely from `git rev-parse -q --verify
   "$before^{commit}"` failing, which is also what happens after a
   force-push rewrites the branch out from under a recorded `before`.
   `check-shell-lines.sh:111` has the identical check and the identical
   wording. Per the plan's Design section: both scripts should attempt
   one `git fetch --no-tags origin <sha>` when the verify fails, retry
   the verify, and only if the SHA is *still* absent fall back to
   comparing against `HEAD^1` — printing that the range starts at the
   first parent because `<sha>` is not in the clone (not a raw failure).
5. **The `report()` summary line's wording is imprecise since #1416.**
   `:184` prints "$after scripts still decide or orchestrate now" — but
   since the kinds `readings` and `paired` exist, `counted()`'s `$2 !=
   "launcher"` filter also counts those rows, which neither decide nor
   orchestrate. Reword to "$after scripts are not launchers now, $before
   at $3" (the wording the plan's Changelog entry and Design section
   both already commit to), so the line says what the filter actually
   measures.

### The decisions the plan settles — do not re-derive them

**Case-fold once, at the read boundary, not at every comparison site.**
`rows()` is the single place every downstream consumer (`counted()`,
`has_evidence()`, the evidence-change filter) reads the Kind cell from.
Lowercase it there — `tolower(trim($(NF - 3)))` in the awk script inside
`rows()` — rather than adding `tolower()` calls at each of the three
comparison sites in `report()` and `has_evidence()`. A fix at the
comparison sites would need three edits kept in sync by hand; a fix at
the read boundary needs one, and nothing downstream needs to know the
table was ever mixed-case.

**Validating the Kind value and validating the cell count are two
separate failure modes, and the plan's own wording keeps them separate:**
"refuses a row whose cell count differs from the header's" and "names a
kind it does not know" are two distinct clauses in the Changelog line.
Don't collapse them into one check — a row with the right cell count and
a bogus Kind should fail with "row N: unknown kind 'Foo'", while a row
with the wrong cell count should fail with "row N: N cells, header has M"
(or similar), because an implementer debugging a CI failure needs to know
which problem they're looking at before they open the README.

**The absent-`before`-SHA retry is `git fetch` then `HEAD^1`, not a
refusal and not "not measured".** The plan names this as an *open
question* ("is `HEAD^1` the right fallback... or must the push run report
'not measured' and pass?") but the Design section already commits to the
fetch-then-`HEAD^1` behavior as the slice's actual shape — read the
open question as the design's own acknowledged limitation (`HEAD^1`
undercounts a force-pushed range larger than one commit), not as a
decision still open for this slice to make differently. Implement
fetch-then-`HEAD^1` exactly as Design says; if you believe the open
question should be resolved the other way, say so in the PR rather than
silently picking "not measured" instead.

**This duplicate exists in two files and both need the same fix.**
`check-shell-lines.sh:111` has the identical `git rev-parse -q --verify
"$before^{commit}"` check with the identical wording. The plan's Design
section says "both `check-decision-count.sh` and `check-shell-lines.sh`
run `git fetch --no-tags origin <sha>` once" — this is a declared shell
duplicate (`docs/shell-and-domain.md`), not a shared helper to extract
into a sourced file; the two scripts already don't source each other,
and introducing that coupling here is out of scope. Apply the same
fetch-then-fallback logic independently in both files' `push` branches.

**No change to the evidence mechanism (`has_evidence()`,
`bundle_holds()`, `read_declared()`).** `read_declared()`'s per-call
pairing bug is issue #1415, the next wave ("Bundle declaration pairing"),
and touches the same file. Do not fix it here — rebasing that wave onto
this one's changes is expected and is why the plan orders them adjacent.
If a test you write for this wave happens to exercise `read_declared()`,
it should pass or fail based on the *current* (unfixed) pairing behavior,
not an anticipated fix.

**Known-kind vocabulary comes from the README, not from this issue's
prose.** The three kinds named in `has_evidence()`'s case statement
(`launcher`, `readings`, `paired`) are the ones that need evidence; they
are not necessarily the *complete* set of valid Kind values. Read
`skills/plot/scripts/README.md`'s current Kind column before hardcoding
a closed list of five — `check-helper-table.sh` (the sibling gate that
reads the same table) may already enumerate the valid kinds, in which
case reuse that list rather than inventing a second one that can drift
from it.

### Done when

The plan's Changelog line is the spec: "The decision gate normalises the
case of a Kind cell, names a kind it does not know, refuses a row whose
cell count differs from the header's, and says 'N scripts are not
launchers'." Concretely:

- A table row with `Kind` cell `Launcher` (or any other-cased spelling of
  a known kind) is read identically to `launcher` — test both that it is
  excluded from the count and that evidence-checking still applies to it
  correctly cased.
- A table row with a Kind cell that is not one of the table's known kinds
  fails the gate, naming the row and the unknown kind in the message.
- A data row with more or fewer `|`-delimited cells than the header row
  fails the gate, naming the row.
- `report()`'s summary line reads "$after scripts are not launchers now,
  $before at $3" (or the plan's exact wording — match the Changelog
  entry's phrasing, not a paraphrase).
- `push` mode, given a `before` SHA absent from the local clone, attempts
  one `git fetch --no-tags origin <sha>`; if that succeeds, proceeds
  normally; if the SHA is still absent, falls back to comparing against
  `HEAD^1` and says so in its output (naming that the range starts at the
  first parent because `<sha>` is not in the clone) rather than failing.
  The identical behavior lands in `check-shell-lines.sh`'s `push` branch.
- Every existing test in `test/reconcile/decision-count.test.mjs` (36
  tests today) and the corresponding file for `check-shell-lines.sh`
  continues to pass unmodified except where its fixture directly
  exercises one of the four changed behaviors (the `push` tests at
  `:341-352` touch the `before`-SHA path and may need their fixtures
  adjusted for the new fetch-then-fallback behavior).
- New tests cover: a mixed-case known Kind, an unknown Kind (named in the
  failure), a row with an extra cell, a row with a missing cell, and a
  `push` run whose `before` SHA is absent locally but fetchable, and one
  whose `before` SHA is absent everywhere (falls back to `HEAD^1`).

Plus: a `plot` patch changeset, description first, `bumps:` block last
(root `CLAUDE.md` § Versioning) — this changes shipped shell under
`scripts/`. Note `scripts/` is not `skills/`: `check-shell-lines.sh`
measures shell line count only under `skills/`, so this gate's own
growth under `scripts/` is not metered by that gate, but the same change
also touches `check-shell-lines.sh` itself, which *is* under `scripts/`
and calls into shell under neither — re-read `check-shell-lines.sh`'s own
header before assuming its line count is unmetered; if it ships anything
under `skills/`, that count still applies. Run `node
skills/plot/scripts/board/plot-local-checks.mjs` before each push and run
what it prints; the suites in the `CI suites` config key (`pnpm run
test:e2e`, `test:contracts`, `test:board`, the domain vitest coverage
run, `node --test test/reconcile/*.test.mjs`) run in CI on the PR, not
locally — do not run them as a matter of course.

Name the shell gate explicitly: `scripts/check-shell-lines.sh` refuses a
PR whose shell under `skills/` is longer than at its merge base. This
slice's primary edits are under `scripts/`, outside that gate's count,
but if any line change under `skills/` sneaks in, it must be paid for in
the same change.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh
```

It reads the plan, finds this branch under the "Decision table reading"
heading, and opens the PR with that heading as title and the plan plus
this brief in the body. When it returns the PR number, append `→ #<N>`
to this branch's line in the plan's `## Slices` section (after "Decision
table reading" / `bug/the-decision-gate-reads-its-table-strictly`), and
commit that to the plan file on `main`. Push the first real commit as
soon as it exists — do not wait for the full slice to open the PR.

### Scope guard

This branch owns exactly:

- `scripts/check-decision-count.sh`
- `scripts/check-shell-lines.sh` (only its `push` branch's `before`-SHA
  handling, per the plan's Design section — not an unrelated rewrite)
- `test/reconcile/decision-count.test.mjs`
- the shell-lines gate's corresponding test file
- a new changeset file under `.changeset/`

Nothing else. In particular: do not touch `read_declared()`'s per-call
pairing logic inside `check-decision-count.sh` (issue #1415, the next
wave, "Bundle declaration pairing" — expected to rebase onto this
branch's changes once it merges); do not touch
`skills/plot/scripts/plot-install-hooks.sh` (the wave after that, "Gate
exit wording"); do not touch any `plot-*-gate.sh` file (off-limits for
the whole plan — owned by the sibling plan `the-gates-are-launchers` in
the same sprint); do not touch `plot-pr-merged.sh`, `reap.ts`, or any
file the five already-merged waves closed.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
