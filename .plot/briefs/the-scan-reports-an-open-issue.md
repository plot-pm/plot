## Implementation brief — a-released-plan-tells-its-tracker (wave 1: The reconcile scan reports a released plan with an open issue)

- **Plan (canonical):** `docs/plans/2026-09-24-a-released-plan-tells-its-tracker.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-scan-reports-an-open-issue` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority

Wave 1 of 2. `feature/a-finished-plan-writes-its-issue-status` (wave 2) waits on this branch merging. The plan's Notes call the order a hedge: if this section shows the case is rare, wave 2 can be dropped. Build nothing that writes.

### What to build

One new read-only section in `skills/plot/scripts/plot-reconcile-scan.sh`: every plan at `Delivered` or `Released` whose `issues[]` names an issue the tracker still reports as open.

The observed failure: `docs/plans/2026-09-17-a-gate-matches-an-invocation.md` reached `Released` in 2.19.0 naming `Issue: #935`, and #935 is still open. A sprint sweep found it, not Plot. Measured at dispatch (2026-09-24): 21 plans are at `Delivered` or `Released` and name an issue, 10 issues are open, and the intersection is exactly one — that plan and #935. **That one line is the section's expected output on this estate.** A section that prints nothing here, or more than that, is wrong.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Ask the host once, with `issue-list`, and intersect.** `plot-host.sh issue-list` returns OPEN issues as JSON lines (`number`, `title`, `url`, …). One call, then a set membership test per plan. The alternative is per-plan `issue-view`, and it cannot answer: its payload is `{number,title,body,url}` with no state, it is documented as reading "ONE open issue", and a closed or missing issue exits 3 — a failure, not a "closed" answer. It would also cost 21 host calls against one.

**The host is reached through `plot-host.sh` and nothing else.** `scripts/check-host-cli-callers.sh` is a CI gate: a `gh issue list` inside the scan fails the build. Call it the way the scan already calls `pr-list` (`plot-reconcile-scan.sh:473` — `PLOT_HOST="$host_env" bash "$host_script" …`, stdin from `/dev/null`, stderr captured).

**Membership means open; absence does NOT mean closed.** Absent is not false. `issue-list` is bounded (`gh issue list` defaults to 30 without `--limit`), and on Jira the default query is the caller's own tickets. So:

- Pass an explicit `--limit`, stated in the output the way section 22 states its window (`PLOT_CHANGESET_MERGE_WINDOW`) and the scan bounds `MERGED_PR_LIMIT=500` (`:374`). A configurable env var with a default is the repo's idiom.
- When the returned count equals the limit, print a note that an open issue beyond the window can be missed. Never print "(none)" as if complete.

**Three outcomes stay apart, exactly as `issue-list` documents them.** Exit 0 with lines → evaluate. Exit 4 → the tracker cannot be asked on this host: print `(not evaluated — …)` with the reason. Any other non-zero → the question failed: print `(not evaluated — …)` with the error. An outage must never print "(none)". Section 22's `(not evaluated — …)` line is the pattern to copy.

**`--offline` / `--no-pr` are honoured.** The scan promises no git-host network call under them, and section 6 already keeps that promise by reading `PR_SOURCE`. When `PR_SOURCE=off`, do not call `issue-list`; print a note naming how many plans went unchecked, the way section 6 does (`n_unrel_unchecked`). The plan's slice line says "gated on the host being reachable" — this is that gate.

**It reports and never gates.** It sits BELOW `== blocking sections end ==`, carries its own footer counter, and stays OUT of `attention=`. A tracker is a copy of Plot's state; an open ticket must never stop `/plot-deliver`. Every advisory section added since section 7 follows this rule, and the comment block above the marker explains it.

**Numbering and placement.** Label it `== 23. … ==`. Print it after section 22 and BEFORE section 6: section 6 prints last by design, and `CLAUDE.md` says so. No consumer reads a section number — the marker is the boundary.

**Read `issues[]` from the parse already in memory.** `plan_json` (`:579`) holds the one `plot-plan-meta.sh` run for the whole sweep; select `.issues` and `.phase` from it with `jq`. Do not add a second parser call, and do not scan plan bodies for `#NNN` — `issues[]` is a dedicated field precisely because a body scan cannot tell a signal from a citation.

**The finding names a decision, not a repair.** Like sections 19–22, print what a person decides: close the issue by hand, or record why it stays open. The plan settles that Plot closes no ticket ("It does not close the issue" — `plot-host.sh` creates none and closes none). Do not print a `gh issue close` command as a remedy. `inspect:` may name `plot-host.sh issue-view <n>`.

**`issues[]` holds numbers.** `plot-plan-meta.sh` parses `Issue: #N`. On a Jira tracker, `issue-list` answers keys, so no number can match. Where the tracker scheme is `jira`, print `(not evaluated — plan Issue: numbers cannot be matched to Jira keys)` rather than a silent clean result. Do not extend the parser; that is outside this branch.

### Done when

The plan's `## Done when` list is written for wave 2. For this branch the specification is the slice line: a read-only section naming every plan at `Delivered` or `Released` whose `issues[]` are still open, gated on the host being reachable, reporting and never writing. The tests below make that concrete. Each exists because a naive implementation passes without it.

Add them to `test/reconcile/scan.test.mjs` using the section-20 fixture pattern (`:3135` onwards): `shimScripts()` copies the scripts, a stub `plot-host.sh` answers `issue-list`, and `origin` is set to a github.com URL after the push with `--no-fetch`.

- **A Released plan and a Delivered plan naming an open issue are both reported**, each with its file and the issue number. Catches a filter on `released` only.
- **A plan naming a closed issue is silent** (the issue is absent from the stub's list). Catches reporting every issue-naming plan.
- **An Approved plan naming an open issue is silent.** Catches a missing phase filter — 9 approved plans on this estate name an issue.
- **A plan naming several issues reports only the open ones** (`Issue: #1, #2`). Catches a whole-plan match.
- **Stub exits 4 → `not evaluated`, counter 0, no `(none)`.** Stub exits 3 → the same with the error text. Catches an outage reading as a clean estate.
- **`--no-pr` → `issue-list` is never called** (have the stub write a marker file and assert it is absent). Catches a broken offline promise.
- **Returned count equal to the limit → the truncation note appears.** Catches a window that looks complete.
- **The new counter is not in `attention=` and the section sits below the marker** — assert via the existing `splitSections` / gate helpers (`runGate`, `:2218`). Catches an open ticket blocking a delivery.

Update the exact footer assertion at `scan.test.mjs:279` for the new key; it is a literal string.

Plus the repo gates:

```bash
nvm use                       # Node 24; pnpm crashes on 26
pnpm test
pnpm run test:contracts
./scripts/check-host-cli-callers.sh
./scripts/check-changeset-packages.sh
```

Do not run `pnpm run test:e2e` locally; CI owns it. Run the new section against this repository once (`skills/plot/scripts/plot-reconcile-scan.sh --no-fetch`, from a real worktree, not a copy in `/tmp`) and confirm it prints exactly the #935 finding.

Docs: update the `plot-reconcile-scan.sh` row in `CLAUDE.md` ("twenty-two sections" → twenty-three, one sentence for section 23 in the style of its neighbours), and the `/plot-reconcile` skill where it describes the sections. Changeset: `'plot': patch`, description first, `bumps:` block last (add `plot-reconcile: patch` if its `SKILL.md` changes), with `plan: docs/plans/2026-09-24-a-released-plan-tells-its-tracker.md`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work is moving). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- Do not close #935. The plan says it wants closing by hand, and that is a person's act.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-reconcile-scan.sh` — the new section and footer key only
- `test/reconcile/scan.test.mjs` — new tests and the footer literal
- `CLAUDE.md` — the scan's table row
- `skills/plot-reconcile/SKILL.md` / `README.md` — section description
- one `.changeset/*.md`

Do not touch `plot-host.sh`, `plot-plan-meta.sh`, the tracker port or its connectors, or `deliver.ts` / `release.ts`. Those belong to wave 2 or to no plan yet.

Verified at dispatch (2026-09-24): no open PR and no unmerged remote branch touches the scan, its test file or the reconcile skill. `origin/bug/the-index-is-read-once` still carries a scan diff, but its PR #948 is merged. No `== 23.` section exists on `main`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
