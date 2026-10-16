## Implementation brief — jira-inbox-and-issue-index (wave: Closed set)

- **Plan (canonical):** docs/plans/2026-10-16-jira-inbox-and-issue-index.md on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1860 merged
- **Branch:** `feature/the-closed-set-answers-for-itself` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (standard PR review; `plot-review` app gate applies)

This branch is independent of the other three slices in this plan — it touches
`issue-refresh.ts`'s error-folding logic only, not the inbox paging
(`feature/the-jira-inbox-read-reports-truncation`, already merged via #1893)
or the ticket-prefix gate (`feature/the-ticket-prefix-scope-has-one-source`,
in flight). Nothing in this plan waits on it and it waits on nothing.

### What to build

Finding #1660 L4: `issue-refresh.ts`'s `refreshIssueIndex` writes the closed
read's (and inbox read's) `unsupported` reason into `state.issueError` on
every pass where the tracker's closed-issue listing is simply not
implemented for that connector (e.g. Bitbucket, which has no closed-issue
read at all). A **standing, expected fact** — "this connector doesn't
support closed-issue listing" — ends up indistinguishable from a **real
failure** of the pass.

The fix is narrow: `state.issueError` must carry only genuine failures (the
open read's own failure, or a closed/inbox read that actually *failed*
rather than being *unsupported*). The `unsupported` reason already has its
correct home — `closedOutcomeOf` (`packages/fleet/src/shared/issue-refresh.ts:126-160`)
already writes it onto `outcome.closed.reason` with `answer: 'unsupported'`.
The bug is that it is *also* folded into the pass-level `state.issueError` at
line 378:

```ts
state.issueError = outcome.error ?? inboxOutcome.error;
```

`outcome.error` (from `closedOutcomeOf`) is non-null for *both* the `failed`
and the `unsupported` case (see line 143: `const error = refusal ?? (unsupported ? read.reason : undefined) ?? ...`).
Only the `failed` case belongs on `state.issueError`. The same shape applies
to `inboxOutcomeOf`'s unsupported case, though note `inboxOutcomeOf` already
returns `inboxSkipped()` (error: null) for its own `unaskable` branch at line
240 — so inbox is likely already correct; **verify this against the test at
line 492 before assuming only `closedOutcomeOf` needs the fix.**

### The decision this plan settles — do not re-derive it

**`state.issueError` is reserved for real failures, never for a standing
"this feature doesn't apply here" fact.** The plan's own Design section
states it directly: "A truncation flag is an answer the host gave, so it may
be stored; a staleness verdict is derived from the stored read time." The
same principle extends here: `unsupported` is an answer about the
connector's capabilities (permanent, structural), not a transient failure
(worth surfacing as a warning / contributing to backoff). Conflating them
means a Bitbucket repository — which can never list closed issues — would
report what reads as an ongoing error on every single pass, forever.

**Note `state.issueError` has no reader today outside `issue-refresh.ts`
itself** (confirmed by grep: no caller of `freshIssueState`/`refreshIssueIndex`
outside `registryd-main.ts` reads `issueState.issueError` back). This is
*not* a reason to skip the fix or treat it as cosmetic — the plan explicitly
groups it as a real, open finding (#1660 L4) from a merged review, and
`state.issueError`'s shape is clearly meant to be read by something (it is
exported on `IssueState` and asserted directly by name in multiple existing
tests, e.g. `issue-refresh.test.ts:340,492,654,676`). Fix the write, not the
(currently absent) read.

**Do not touch `fleet.ts`'s `entry.issueError`.** That is a different field
on a different struct (`FleetEntry`, `packages/board/src/server/fleet.ts`),
derived from the top-level `IssueIndex.answer`/`.reason` (the *open* read's
own outcome), not from this `IssueState`. It is out of scope for this
finding — confirmed by reading `fleet.ts:1990-2051`, which never reads
`IssueState` at all.

### Done when

The plan's `## Done when` has no explicit list for this slice (the plan
names "move the closed read's `unsupported` reason off `state.issueError`"
in the Slices section directly). Treat this as the specification:

- A closed (or inbox) read that answers `unsupported` leaves `state.issueError`
  `null` (assuming no other, independent failure occurred this pass).
- A closed (or inbox) read that answers `failed` still sets `state.issueError`
  exactly as today — this finding narrows the `unsupported` case only, it
  does not touch the `failed` path.
- Add or adjust a test in `packages/fleet/test/unit/issue-refresh.test.ts`
  that pins this: an `unsupported` closed read (e.g. the existing fixture
  used at line 367, "spends one request where the tracker answers unaskable
  for the closed read") must assert `state.issueError` is `null` where today
  it is unasserted — this is the naive-implementation trap: the existing
  test passes today *without* checking the field the finding is about, so a
  reviewer re-running it would see green and assume no regression.
- Re-run the existing `state.issueError` assertions (lines 340, 492, 654,
  676 in the test file) to confirm none of them regress — they all cover
  cases that must keep setting the field (the `failed` and `nobody`/`cannot
  be asked` paths), which this fix must leave untouched.

Plus: the repo's gates — build artifacts, changeset, platform constraints.
For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints: the tests that name a changed file, the
related tests and typecheck of a changed package, and the gate tests and
`scripts/check-*.sh`. The suites in the `CI suites` config key run in CI on
every pull request — do not run them locally as a matter of course.

No `.sh` file is touched by this change, so `scripts/check-shell-lines.sh`
does not apply.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
```

It reads which plan names the branch and opens the PR with the plan's wave
heading as the title, the plan and this brief in the body. Push the first
real commit as soon as it exists — do not wait for the whole fix before
pushing.

When the PR is created, append `→ #<number>` to this branch's line under
the plan's `## Slices` section (`### Closed set`), per
`docs/plans/2026-10-16-jira-inbox-and-issue-index.md:72`.

### Scope guard

**Owns:** `packages/fleet/src/shared/issue-refresh.ts` (the `refreshIssueIndex`
function, specifically the `state.issueError` assignment around line 378,
and possibly line 419 if the same unsupported/failed conflation exists on
the open-read-failure path — check `answer === 'unsupported'` vs `'failed'`
there too) and `packages/fleet/test/unit/issue-refresh.test.ts`.

**Does not own:** `packages/board/src/server/fleet.ts` (`entry.issueError` —
different field, different struct, out of scope — see above),
`packages/board/src/app/lib/agent-rows/host-notes.ts` (reads `fleet.issueError`,
not `IssueState.issueError` — unaffected by this fix), the inbox-paging code
in `inboxOutcomeOf`/`closedOutcomeOf`'s `rows`/`complete`/`at` handling
(owned by the already-merged `feature/the-jira-inbox-read-reports-truncation`,
PR #1893), and the `PLOT_TICKET_PREFIXES` gate code (owned by
`feature/the-ticket-prefix-scope-has-one-source`, in flight, not yet merged
to `main` as of 2026-10-17).

If you find the same unsupported/failure conflation in code this brief does
not name, report it rather than expanding scope silently — it may belong to
the Coverage slice (`feature/the-tracker-connector-paths-are-tested`)
instead.
