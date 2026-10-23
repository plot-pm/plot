## Implementation brief — plot-host-bitbucket-pr-list-reads

- **Plan (canonical):** [docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md](../../docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md) on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2402 merged
- **Branch:** `bug/plot-host-bitbucket-pr-list-reads` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate, required on `main` since 2026-10-15)

### What to build

`bb_state_listing` (`skills/plot/scripts/plot-host.sh:1286`) asks Bitbucket for
one page of 50 PRs per state (`bb api …/pullrequests?state=<s>&pagelen=$BB_LIST_PAGELEN`)
and never follows `next`. Any PR older than the newest 50 in its state reads as
"no PR" — a false negative, not a timeout or an error, so nothing downstream
notices it happened.

The fix is: once `bb pr list --all` exists and is version-gated, switch
`bb_state_listing` (and the `--updated-since` window) to call it instead of
hand-building the `bb api` request, so the listing follows every page by
construction rather than by row-count inference.

**Read the plan's Design section fully before writing anything** — it names
every call site that holds the one-page assumption (`bb_state_listing`,
`BB_LIST_NEXT_FILE`, `pr_list_report_truncation`, `BB_LIST_PAGELEN`,
`BB_LIST_PAGE_VERSIONS`, `bb_branch_query`, `bb_window_listing`, and the TS
mirror `packages/domain/src/adapters/host/listing-paging.ts`) and the plan's
own `## Open Questions` are not yet answered.

### The decision this brief adds to the plan: check the blocker before writing code

**This plan is blocked on an external dependency that may not have shipped.**
The Motivation section is explicit: the fix depends on
`quatico-solutions/agent-skills#98` (`bb pr list` pagination, `--all`,
`--updated-since`), targeted for agent-skills 3.18.0 in the sprint
2026-10-26 to 2026-10-30 — **a week after this plan's approval date**. The
local `bb` measured in the plan is 1.11.2, which does not carry `--all`.

**Before writing any code, check whether `bb pr list --all` exists yet:**

```bash
bb --version
bb pr list --help 2>&1 | grep -- '--all\|--updated-since'
```

- **If `--all` is not yet supported** (the expected case before 2026-10-26):
  do not implement a workaround and do not simulate the flag. Report back
  through the brief's bookkeeping channel that the dependency has not
  shipped, leave the branch with no commits beyond this brief, and say so in
  the PR if one gets opened — this is exactly the kind of drift
  `/plot-implement`'s staleness preflight exists to catch, and it was caught
  one layer later, at coding time, because `bb` is not installed in the
  dispatching session that wrote the plan or this brief.
- **If `--all` is supported**, confirm the version string against the plan's
  `## Open Questions` (which `bb` version carries it — the plan guesses
  3.18.0 but does not know) and proceed with the Design section's four steps,
  recording the actual version in `BB_LIST_PAGE_VERSIONS`'s sibling table (or
  wherever the gate ends up living — that choice is one of the plan's open
  questions, not settled here).

This is not a new rule — it is the plan's own Notes section (*"Blocked on
quatico-solutions/agent-skills#98 shipping. Approve and implement after
agent-skills 3.18.0 is available."*) made load-bearing for whoever picks up
this branch, because the dispatching session has no `bb` on `PATH` to check
it directly.

### Rules carried over unchanged from related work

- **A full page cannot prove absence.** `bb_branch_query` and
  `bb_window_listing` already carry this invariant in their own comments
  (`plot-host.sh:1079`) — do not weaken it while touching the listing path.
- **Absent is not false.** `pr_list_report_truncation`'s completeness claim
  (`plot-host.sh:3030`) is the adapter's to make, never the caller's to infer
  from a row count — see the `BOTH SENTENCES OR NEITHER` comment at
  `plot-host.sh:3016` for why a complete and a truncated report are one
  decision, emitted from one place.
- **The envelope's own `next` supersedes the version-length test**, for any
  `bb` version (`plot-host.sh:3016`, #1757 reference). If the replacement
  command returns a different envelope shape than `bb api` did, re-derive
  whether this invariant still has something to read, rather than deleting it.
- **The layering rule holds.** The change stays in `plot-host.sh` and
  `packages/domain/src/adapters/host/listing-paging.ts`. No controller or
  rule gains a Bitbucket branch (CLAUDE.md § The Layering Rule).

### Done when

The plan carries no `## Done when` list of its own — it is a Design-stage
plan whose Changelog line is the specification: *"`plot-host.sh pr-list`
reads every page of a state's pull requests when the installed `bb` supports
`bb pr list --all`, so a PR outside the newest 50 stops reading as `no PR`. An
older `bb` keeps the single-page listing and its notice."* Treat that sentence
as the acceptance test, plus:

- The stale `--limit` comment and notice at `plot-host.sh:4521` (*"`bb pr
  list` refuses `--limit` with `unknown flag`"*) and `:4529` (*"bitbucket
  ignores --limit"*) are removed or corrected once `--all`/`--limit` work —
  a reader five years from now should not learn a false constraint from a
  comment the code no longer has.
- A capability gate exists before the new path is called, in the shape of
  `bb_require_json`/`bb_test_json_support` (`plot-host.sh:2502-2578`):
  behavioural probe, not a version-string guess, with the three observations
  (`BB_CAP_PROBE_RC`, `BB_CAP_PROBE_MATCH`, `BB_CAP_IDENTITY`) a refusal can
  cite.
- An older `bb` (no `--all`) keeps today's single-page `bb_state_listing`
  path and its truncation notice exactly as before — this is explicitly an
  **addition**, not a replacement, until the gate says otherwise.
- `packages/domain/src/adapters/host/listing-paging.ts` is updated in the
  same change if the envelope shape the new command returns differs from
  `bb api`'s `{values, page, next}` shape — `envelopeNextFor` reads that
  shape by name (`Object.hasOwn(page, 'values')`, `'page'`, `'next'`).

Plus the repo's standing gates: `scripts/check-shell-lines.sh` refuses a PR
whose shell under `skills/` grows past its merge base — this change likely
nets shell lines even (new gate code for old notice code), but if it grows,
pay for it in the same change rather than carrying a note promising a later
cleanup. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints — it resolves the tests that name your
changed files, the related tests and typecheck for any touched package,
and the gate tests and `scripts/check-*.sh` scripts. The `CI suites` config
key runs in CI on every PR; do not run the full e2e suite locally (CLAUDE.md
§ Testing — it dispatches real workers into sandbox repos and starves the
shared machine).

### Bookkeeping

Push the first real commit as soon as it exists (even if that commit is only
"blocked: `bb` on PATH does not yet support `--all`" with no code change, per
the decision above). Open the PR through the controller:

```bash
../plot/scripts/plot-open-pr.sh          # the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Do not run `gh pr create` — the controller reads which plan names the branch
and sets the PR title from the plan's wave heading. When the PR exists,
append `→ #<number>` to this branch's line in the plan's `## Slices` section
(the branch has no wave heading, just one line under `### Listing`).

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` (the `bb_state_listing`
family and the `--limit`/notice comments named above) and
`packages/domain/src/adapters/host/listing-paging.ts`. No other branch is
currently in flight against this plan — it has exactly one slice. Do not
touch `plot-fleet-scan.sh`, any controller, or any rule file: the plan's
Design section is explicit that this stays adapter-only.

If you find something the plan did not anticipate — in particular, if
`bb pr list --all` turns out to behave differently than the plan assumes, or
agent-skills#98 shipped with a different flag shape — report it rather than
improvising past the plan's Open Questions.
