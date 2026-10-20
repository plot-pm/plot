## Implementation brief — bitbucket-jenkins-a-pr-list-row

- **Plan (canonical):** `docs/plans/2026-10-20-bitbucket-jenkins-a-pr-list-row.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2184 merged
- **Branch:** `bug/bitbucket-jenkins-a-pr-list-row` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** PR review per repo convention (plan `Review: pr`)

### What to build

Under `CI: jenkins`, `pr-list --rich` reports `checks: "unknown"` for two
different rows, and a reader cannot tell them apart: a row past
`SHA_LOOKUPS_PER_PASS` (`packages/domain/src/rules/jenkins-pr-checks.ts:38`,
currently 5) that the pass never asked Jenkins about, and a row Jenkins
genuinely cannot answer (no build, or a non-conclusive result such as
`ABORTED`). Field test 2026-10-20 against ewz-kus-portal: 9 open PRs, the 4
past the cap (3509, 3237, 3210, 3094) all read `unknown` with `checksSha: ""`,
even though Jenkins has real builds for their heads (3509 → SUCCESS). Because
the cap is fixed and the rotation always keeps the same newest-`updatedAt`
rows inside it, those 4 rows never bind on any later pass either — a
repository with more open PRs than the cap has a permanently-blind subset.

Two mechanisms, and the plan says they combine: (1) a distinct state for
"not looked up this pass" versus "Jenkins answered unknown", and (2) rotation
across passes so every open PR gets a bound answer within a bounded number of
passes, rather than the same 5 newest rows winning every time.

### Settled decisions — do not re-derive them

- **This is a board-readability gap, not a merge-safety gap.** The merge
  guard (`packages/domain/src/workflows/merge.ts:106-107`, `checks-unbound`)
  already refuses to merge on a `checksSha` that doesn't equal `headSha` — a
  capped row with `checksSha: ""` can never satisfy that check, so it was
  never going to merge wrongly. The defect is purely that a human reading the
  board cannot distinguish "nobody has looked at this yet" from "Jenkins has
  no opinion", which is what the issue (#2170) and the plan's title are
  actually about. Don't scope-creep into merge-guard changes; none are
  needed.

- **The cap, the ambiguity check, and the per-row read all live in
  `rowsToBind`/`bindChecks`** (`packages/domain/src/rules/jenkins-pr-checks.ts`),
  shared by both host backends. `rowsToBind` (line 58) already sorts by
  `updatedAt` descending and slices to `limit`; it is the one place that knows
  which rows got dropped for the cap versus which never needed a lookup
  (`ambiguous` false — `none`/`pending` colours need no sha). Both the
  GitHub+Jenkins arm (`skills/plot/scripts/plot-host.sh:4259-4304`) and the
  Bitbucket+Jenkins arm (`:4421-4475`) already thread a `$named` array through
  jq (`jenkins_bind_rows`'s 4th-arg side file, built from `rowsToBind`'s
  selection) that lists exactly which rows the pass picked. **The
  "not-looked-up" signal already exists in the shell as `$wasNamed` false** —
  it is simply discarded into the same `"unknown"` word at
  `plot-host.sh:4296` and `:4465-4467`. Giving it a distinct value is a change
  to those two jq expressions (and whatever the domain introduces for the
  word/field itself), not a new signal to invent.

- **Open Question 1 (new `checks` word vs. separate field) is the one to
  close first, and it has load-bearing readers on both branches of the
  choice.** `ChecksSchema` (`packages/domain/src/entities/pr.ts:32`) is the
  one enum: `z.enum(['green', 'pending', 'failing', 'none', 'unknown'])`.
  Readers that branch on its exact words:
  - `checks-reading.ts:100,193,240` — `'unknown'` drives the board's "note"
    severity and its `supervisorStatus`-style bucket. A new word needs its
    own branch here or it silently renders as nothing.
  - `packages/board/src/contract/schema.ts:315` — `ChecksSchema.default('unknown')`,
    the wire contract every board client parses against.
  - `packages/board/src/server/fleet.ts:4802-4815` — reduces `checks` to a
    one-word board badge; a new word needs a reduction rule or it falls
    through.
  - **`packages/domain/src/rules/pr-index.ts:187-192,245`** — `ABSENT_VERDICTS.checks = 'unknown'`
    is the sentinel the index fold uses to mean *"this terminal (`MERGED`/
    `CLOSED`) row's `checks` was never asked, keep what the store already
    held."* This is a different "not asked" than the one this plan is
    solving (index-fold-time vs. pass-time-cap), but it reads the **same
    string**. If a new `checks` word is chosen, verify it is never emitted
    for a terminal row (it shouldn't be — `rowsToBind` and the cap only ever
    apply to open PRs with ambiguous branch-colours) so it can never collide
    with this sentinel. If a separate field is chosen instead, this
    collision risk doesn't exist at all — one more reason the field option is
    the lower-risk mechanism. Read `pr-index.ts:194-234`'s doc comment before
    deciding; it states the "absent is not false" rule this plan must not
    violate from the other direction.
  - `packages/board/server/mock-fleet.ts:522` and any board fixture
    hardcoding `checks: 'unknown'` — gated by `ChecksSchema`'s zod enum, so an
    unhandled new word fails to parse rather than silently passing; that's a
    feature, not a bug to work around.

- **A sibling branch is live on `pr-index.ts` right now — check before you
  touch it.** `origin/feature/a-merged-pending-check-is-asked-again` edits
  `packages/domain/src/rules/pr-index.ts` (+31/-fewer lines) and
  `packages/board/src/server/fleet.ts` (+138 lines), both files this plan's
  "new word" option would also touch. Diff against its current state before
  editing either file; do not redo its work, and flag a real conflict rather
  than silently resolving it your way.

- **A second sibling branch, `origin/bug/jenkins-runs-skip-builds-that-did`,
  also edits `plot-host.sh`**, but a different function (`jenkins_sha_runs`,
  the `runs` command's build-history filter) — not `pr-list`'s binding logic.
  File overlap only; no logical overlap expected, but diff before merging.

- **Rotation (Open Question 2) is a pure-function change if it belongs in
  `rowsToBind`.** The plan's Design section already argues for this: "the
  memory is a bound answer in the PR index (`checksSha` against `headSha`),
  not a new store, and `pr-refresh.ts` stays the only writer." Read
  `pr-refresh.ts` and `pr-index.ts` before choosing where rotation lives —
  the repo's "a decision reads the index" rule
  (`CLAUDE.md` § A Decision Reads The Index) means a cheap fix is to make
  `rowsToBind` prefer rows whose stored `checksSha` is stale or absent over
  rows already bound to their current head, using the index as a read-only
  input — not to add new state to track rotation across passes.

- **Open Question 3 (cost per Jenkins lookup, and what cap that allows) is
  explicitly a "measure before implementing" item** (CLAUDE.md § Model Tiers
  and the repo's standing rule, also invoked verbatim in the plan's Design
  section). Do not pick a new cap number without measuring against a real
  Jenkins first — the predecessor plan (#2154, delivered as #2160) measured
  7.5s for 11 rows / 5 lookups on ewz-kus-portal; get a comparable number
  before touching `SHA_LOOKUPS_PER_PASS`, and say what you measured in the PR
  description if you change it.

- **Open Question 4 (does the GitHub-plus-Jenkins arm share the gap) is
  "yes" — confirmed while writing this brief.** `plot-host.sh:4296` has the
  identical collapse: `checks:(if $jstatus != "ok" then "unknown" elif $eff
  == null then (if $ambiguous then "unknown" else "none" end) else
  $eff.checks end)` — the `$ambiguous` branch returns `"unknown"` for both a
  row `$wasNamed` dropped (past cap) and one Jenkins couldn't answer. Both
  arms (`:4292` GitHub, `:4457` Bitbucket) build `$ambiguous`/`$wasNamed` the
  same way and need the same fix; do not fix one arm and leave the other.

### Done when

The plan's slice line is the specification: a row past the lookup cap reads
distinct from a row Jenkins cannot answer, and every open PR binds within a
bounded number of passes. The assertions a naive implementation would pass
without:

- **A fixture with more open PRs than the cap, asserting the capped rows'
  new word/field differs from a row with a genuine Jenkins `ABORTED`/no-build
  answer.** The existing `host.test.mjs` fixtures (`jenkinsBuildsFor`,
  `makeJenkinsRestBin`) are the established pattern — extend rather than
  duplicate them.
- **Both the GitHub+Jenkins arm and the Bitbucket+Jenkins arm get the fix**
  (Open Question 4 above) — one test per arm, not one shared test that only
  exercises whichever arm you wrote first.
- **A rotation test across at least two passes**, proving a row left out of
  pass 1 is picked up in pass 2 rather than the same newest-`updatedAt` rows
  winning every time. Assert this against the mechanism you chose
  (`rowsToBind` unit test if rotation lives there; an integration test if it
  needs the index).
- **A terminal (`MERGED`/`CLOSED`) row's `checks` is unaffected** — the
  `pr-index.ts` absent-verdict sentinel this brief flagged above must still
  round-trip exactly as `pr-index.test.ts` currently asserts. Run that suite
  as part of your local checks regardless of which mechanism you choose,
  since both touch adjacent code.
- **The board (or `fleet.ts`) renders the new word/field without falling
  through to a blank or mis-bucketed badge** — if you add a word, add its
  branch in `checks-reading.ts` and `fleet.ts`'s reduction; if you add a
  field, confirm existing `checks: 'unknown'` readers are unaffected by its
  mere presence.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each
push and run what it prints. The suites in the `CI suites` config key run in
CI; a failure there comes back as a correction. `host.test.mjs` is slow under
load — run the test names you touched
(`node --test --test-name-pattern=…`), not the whole file in a loop. Add a
changeset (`plot: patch`, description first, `bumps:` block last, `plan:`
line inside the block pointing at this plan — board-impact note in the plan's
Changelog section says whether `@plot-pm/board` also needs a bump, depending
on which mechanism you choose).

Name the shell gate: `scripts/check-shell-lines.sh` refuses a PR whose shell
under `skills/` is longer than at its merge base. This branch touches
`plot-host.sh`'s two jq expressions (`:4296`, `:4465-4467`) — if the new word
or field adds net lines, pay for it in the same change (remove shell
elsewhere, or move the logic into the domain and ask it through a bundle, per
`CLAUDE.md` § A Shell Script Asks The Domain). The gate stores no number and
grants no exemption.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`).
Append `→ #<number>` to this branch's line in the plan's `## Slices` section
(`docs/plans/2026-10-20-bitbucket-jenkins-a-pr-list-row.md`, under `### Not
looked up`) when the PR exists. Push the first real commit as soon as it
exists.

### Scope guard

This branch owns: `rowsToBind`/`bindChecks`
(`packages/domain/src/rules/jenkins-pr-checks.ts`), the two `pr-list --rich`
Jenkins jq arms in `skills/plot/scripts/plot-host.sh` (GitHub `:4259-4304`
and Bitbucket `:4421-4475`), whatever `ChecksSchema`/field change the chosen
mechanism needs, the rotation mechanism itself, and this plan's four Open
Questions (close each one in the plan, with what you found, rather than
leaving code and plan prose disagreeing — same convention the predecessor
plan #2154 set).

In flight, verified against the plan at dispatch time:

- `origin/feature/a-merged-pending-check-is-asked-again` — edits
  `packages/domain/src/rules/pr-index.ts` and `packages/board/src/server/fleet.ts`.
  Both are files this plan's "new word" option may also touch. Diff before
  editing either.
- `origin/bug/jenkins-runs-skip-builds-that-did` — edits `plot-host.sh`'s
  `jenkins_sha_runs` (the `runs` command), a different function than the
  `pr-list` binding this plan touches. File overlap only.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
