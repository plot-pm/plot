## Implementation brief — a-planned-issue-shows-its-plan (wave 1: Connector and inbox)

- **Plan (canonical):** `docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1985 merged
- **Branch:** `feature/issue-plan-state-inbox` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention
- **Answers:** GitHub issue #1979 (in part)

Independent of `feature/issue-plan-state-write`: that branch touches the domain's tracker port and adapters; this one touches `packages/board/src/server/fleet.ts` only and reads no label. `feature/issue-plan-state-commands` waits on `issue-plan-state-write`, not on this branch.

### What to build

The board's unplanned-issue filter has two gaps, both in `packages/board/src/server/fleet.ts`. Fix both; neither reads a tracker label — the inbox derives "planned" from git, as it does today.

**Gap 1 — the inbox misses issues of a Draft plan PR.** `referencedIssues` (`fleet.ts:1462`) reads every `*.md` file under the configured plan directory on the checked-out tree, and nothing else. A plan still in review lives on its `idea/<slug>` branch (`/plot-idea`'s convention, matched elsewhere in this file by `IDEA_BRANCH`, `fleet.ts:4756`) and is not in that directory yet — it only lands there once `/plot-approve` merges the plan PR. So the issue named by a Draft plan's `Issue:` field shows as unplanned on the board while a plan already exists for it. Add those issues to the `referenced` set: for each open `idea/` branch with a PR, read its plan file at that ref (not the working tree) and fold in its `issues` the same way the directory loop does.

**Gap 2 — *Waiting on you* is never filtered.** `waitingOf` (`fleet.ts:1772`) calls the domain's `waitingTickets(rows, inbox, reader, source, complete)` — and both call sites (`fleet.ts:1939`, `:2054`) pass `rows` **unfiltered by `referenced`**. `inboxOf` (`fleet.ts:1723`), called right next to it in both places, filters correctly: `rows.filter((row) => !referenced.has(issueKey(row.number)))`. `waitingTickets`'s own doc comment (`packages/domain/src/rules/waiting-tickets.ts`, the paragraph beginning "`rows` and `inbox` are read exactly as given") already says the caller owns this filter — `waitingOf` is the caller that was supposed to and doesn't. Filter `rows` (and, where passed, `inbox`) by `referenced` before handing them to `waitingTickets`, at both call sites.

### Settled decisions — do not re-derive them

**No label is read, here or anywhere.** `feature/issue-plan-state-write` adds a one-way label write (Plot writes `plan:*`, no Plot code reads it back) — that is a different mechanism for a different purpose (what a person sees *in the tracker*), and this slice does not touch it, import it, or wait on it. This slice's job is what the board shows, and the board has always derived "planned" from git, never from a label (`skills/plot/MANIFESTO.md:17`). Reading the label here would be a second, cheaper-looking way to answer the same question and would drift from the git-derived answer the moment someone edits a label by hand.

**Read the Draft plan's content at the branch ref, not off disk.** The `idea/<slug>` branch is not checked out, so the plan file is not at a readable path under `opts.repoRoot`. `releaseVersions` (`fleet.ts:1218`, reading `origin/changeset-release/main:package.json`) is the established pattern in this file for reading a file off a ref without a checkout — one `git show`, not one per row, built from refs already in hand. `plot-plan-meta.sh` (driving `scriptsFor(opts).planMeta`) takes real file paths; it does not take a `ref:path` spec. Pipe the ref's content through it rather than teaching the parser a new input shape — write the `git show` output to a temp file and hand that path to `planMeta`, the same shape `referencedIssues` already uses for on-disk files. Do not add a second plan parser.

**Which branches to check, and how to find them cheaply.** The board already walks open PRs on `idea/` branches to build `plan` rows (`fleet.ts:4774` area, `carriesDraftPlan`/`IDEA_BRANCH`). Reuse that enumeration rather than a second `git branch` scan — the PRs are already fetched for the pulse this function runs beside. A branch with no open PR is not "a plan under review" by this file's own rule (`carriesDraftPlan`'s doc comment: the idea prefix alone marks a plan, PR or not) — but **gap 1 only needs issues that are actually unmerged-and-pending**, so match what the board already treats as a Draft plan row rather than inventing a looser or stricter test.

**A failure to read one branch's plan must not blank the whole set.** `referencedIssues` returns `null` on any failure today, read by its own doc comment as "decline to answer" rather than "nothing is planned" — a correct rule for a wholesale read failure (no plan directory), and the wrong one if one `idea/` branch's `git show` happens to fail while the on-disk plans read fine. Keep the directory read's own failure path as `null`; let a single branch's unreadable plan drop silently from the set it contributes to (same "last good / keep what you have" shape the PR and run-history reads in this file already use for a flaky fetch), rather than discarding every on-disk reference because of it.

**`ISSUE_LIMIT` and the unplanned filter are upstream of `waitingTickets`, never inside it** — restated because gap 2 is exactly this rule unapplied. Fix the call sites; do not add a filter parameter to `waitingTickets` itself, which would duplicate the test `inboxOf` already passes.

### Done when

The plan's `## Slices` line for this branch is the specification: *"`referencedIssues` adds the issues a Draft plan PR's plan names, and `waitingOf` receives the rows filtered by `referenced`; no label is read."* Beyond it, assertions a naive implementation would pass without:

- An issue named only by a Draft plan PR's `Issue:` field (plan on `idea/<slug>`, not yet in the plan directory) is absent from both the inbox and *Waiting on you* — catches reading only the on-disk directory.
- The same issue, once its plan PR merges and the plan lands in the directory, stays absent — catches a regression where the two reads disagree once the branch that fixed gap 1 is no longer needed for that issue.
- *Waiting on you* never lists an issue a plan already references — catches the unfiltered-`rows` bug directly; today's code fails this one.
- A tracker-account reader (unmatched login) still sees the unplanned set only, via `inbox` — catches filtering `rows` but forgetting the `inbox` argument at the same call sites.
- A merged plan PR with no `Issue:` field, and a repo with zero open `idea/` branches, both leave `referencedIssues` returning exactly what the directory read already gave — catches the new logic changing behaviour when there is nothing for it to do.
- One failing `git show` for one `idea/` branch's plan does not turn `referencedIssues` null when the plan directory itself reads fine — catches over-applying the "decline to answer" rule from the directory-read failure path.

Plus: a changeset (`plot: minor` with a `bumps:` block last, description first — see `## Versioning` in `CLAUDE.md` for the ordering gate). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. This slice adds no shell under `skills/`, so `scripts/check-shell-lines.sh` should need nothing — if a helper script does turn out to be the simpler way to enumerate `idea/` branches, growth there must be paid for by removing an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned by this branch: `packages/board/src/server/fleet.ts` (`referencedIssues`, `inboxOf`'s call sites, `waitingOf`'s call sites), its tests under `packages/board/test/`, and the changeset.

Not owned: `packages/domain/src/rules/issue-status.ts`, `packages/domain/src/ports/tracker.ts`, `packages/domain/src/entities/issue.ts`, `packages/domain/src/adapters/tracker/*`, `plot-host.sh`, `plot-issue-status.sh` (all `feature/issue-plan-state-write`); `plot-idea`, `plot-approve`, `plot-deliver`, `plot-release` skills and `plot-reconcile-scan.sh` (`feature/issue-plan-state-commands`).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
