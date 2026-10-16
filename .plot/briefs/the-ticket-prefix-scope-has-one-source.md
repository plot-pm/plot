## Implementation brief — jira-inbox-and-issue-index (wave 2: Scope gate)

- **Plan (canonical):** `docs/plans/2026-10-16-jira-inbox-and-issue-index.md` on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1860 merged
- **Branch:** `feature/the-ticket-prefix-scope-has-one-source` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR, per the plan's `Review:` answer; issue #1849

This wave does not wait on wave 1 (`feature/the-jira-inbox-read-reports-truncation`, merged as #1893) — it touches a disjoint surface (config reads in the adapter and `plot-host.sh`, not the inbox read's paging/truncation fields) — but rebase onto `main` regardless, since #1893 already landed and both waves sit in `packages/domain/src/adapters/tracker/`. Waves 3 (`Closed set`) and 4 (`Coverage`) are not yet started.

### What to build

Today, **"is `Ticket prefixes` declared"** is answered from four independent reads, and only one of them honors `PLOT_TICKET_PREFIXES`:

1. `plot-host.sh`'s `tracker_projects()` (`skills/plot/scripts/plot-host.sh:2512`) — honors the override, called once per `issue-list` invocation (open/closed/inbox are each a separate shell invocation, so a Jira pass that runs all three spends three `plot-config.sh get "Ticket prefixes"` subprocess spawns, not one).
2. `trackerJira.issueListInbox` (`packages/domain/src/adapters/tracker/tracker-jira.ts:116-124`) — spawns its own `bash plot-config.sh get "Ticket prefixes"`, blind to `PLOT_TICKET_PREFIXES`.
3. `trackerJira.issueOpen` (`tracker-jira.ts:160-161`) — spawns a *fourth* read for the same key (plus a fifth for `Tracker issue type`), also blind to the override.

A test or an operator setting `PLOT_TICKET_PREFIXES` therefore sees `issue-list`'s open/closed/inbox reads scope correctly while `issueListInbox`'s own gate and `issueOpen`'s project pick read the *unoverridden* `plot-config.sh` value — the two can disagree inside one pass. That is finding L1. Finding L2 ("the gate spawns one extra `plot-config.sh` per Jira pass") is the same root cause from the other side: nothing caches or shares the answer, so every caller re-spawns.

Separately, `issue-open`'s shell arm (`plot-host.sh:5037`, `case "$(tracker_scheme)" in jira) … ;; github-issues) … ;; *) exit 4`) dispatches on `tracker_scheme()` — the raw first word of the `Tracker` config value — instead of asking `issueSource` the way `issue-list` and `issue-view` already do via the `issue_source` helper (`plot-host.sh:2446`, which calls `board/plot-issue-source.mjs`). This is the exact drift the comment at `plot-host.sh:2422-2432` exists to warn about and was written for: *"`issue-list` and `issue-view` tested `tracker_scheme = jira` and sent every other scheme to the git host… measured 2026-10-01, `PLOT_HOST=github PLOT_TRACKER=linear issue-list` exited 0 having called `gh issue list`"* — `issue-open` still carries the pattern that comment documents as already-fixed-elsewhere.

Plan reference: `docs/plans/2026-10-16-jira-inbox-and-issue-index.md` is canonical; this brief is orientation, not a substitute.

### Settled decisions — do not re-derive them

- **One gate source means the shell's answer, not a new shared cache.** `tracker_projects()` in `plot-host.sh` already honors `PLOT_TICKET_PREFIXES` and already normalises the list (comma-split, trimmed, empties dropped). The TypeScript side (`trackerJira.issueListInbox`, `trackerJira.issueOpen`) must ask the *same* answer rather than re-reading `plot-config.sh` directly — either by shelling to `tracker_projects` through a small `plot-host.sh` op that prints the normalised list (cheapest, keeps the override logic in the one place that already has it), or by piping `PLOT_TICKET_PREFIXES`/`plot-config.sh` reads through one shared helper in `tracker-jira.ts` that both `issueListInbox` and `issueOpen` call. Either is acceptable; a *third* independent `bash plot-config.sh get "Ticket prefixes"` call site is not — that is the defect, not a variant of the fix.
- **The override must be honored on the TypeScript side too.** `PLOT_TICKET_PREFIXES` is read nowhere in `tracker-jira.ts` today — grep confirms zero hits outside `plot-host.sh` (comments aside). The fix is incomplete if `issueListInbox`/`issueOpen` keep reading `plot-config.sh` unconditionally and only `plot-host.sh`'s own shell callers see the override.
- **`issue-open`'s shell dispatch moves from `tracker_scheme()` to `issue_source`, matching `issue-list`/`issue-view`.** Call the existing `issue_source` helper (`plot-host.sh:2446`) before the `case` statement; dispatch on its answer (`tracker\tjira`, `tracker\tgithub-issues`, `nobody\t<reason>`, `git-host`) rather than on `tracker_scheme()`'s raw first word. `issue-open` has no git-host arm today (`issueSource`'s `git-host` case has no connector for writes) — keep it that way: a `git-host` or `nobody` answer still exits 4 with a reason, it just now comes from the same rule the read ops already trust instead of a second hand-rolled copy of it. Do not add a github/git-host write path; that is out of scope.
- **The one extra spawn per pass this slice removes is real but small — measure, don't assume a bigger number.** L2 says "one extra" in the plan's own wording; the actual count today is up to 4 independent `plot-config.sh` reads of the same key in one Jira pass (open+closed+inbox via `tracker_projects`, once each from three separate `plot-host.sh issue-list` invocations, is expected and not itself the defect — those are three different ops, each legitimately asking once; `issueListInbox`'s and `issueOpen`'s *extra* reads are the ones in scope here). Do not try to collapse the three `issue-list` invocations into one process — that is a different, larger change this plan does not ask for.
- **`#1659`'s open question is answered by this slice, not deferred.** The plan's Open Questions ask "Does `PLOT_TICKET_PREFIXES` still apply to `issue-open`?" — yes: `issueOpen` reads the same `Ticket prefixes` key `issue-list`'s scope does, so the override must reach it the same way. Record this answer in the PR body against the plan's Open Questions list (the plan itself is not amended by this branch; `/plot-deliver` or a later pass folds answered questions back).
- **Carried-over invariants:** absent is not false — an undeclared `Ticket prefixes` must keep reading as *unscoped*, never as an error, exactly as `tracker_projects()` and `issueListInbox`'s existing `unaskable` path already treat it; read the exit code, not the emptiness, for every `plot-config.sh`/`plot-host.sh` subprocess result; the layering rule (`CLAUDE.md` § The Layering Rule) — the decision of *which scheme to ask* belongs to the domain's `issueSource` rule, and `plot-host.sh` is the one place that calls out to it (via `board/plot-issue-source.mjs`), so this slice must not re-implement the scheme/dispatch logic a third time in `tracker-jira.ts`.

### Done when

The plan carries no dedicated `## Done when` section; its `## Changelog` and the Motivation's L1/L2/`#1659` bullets are the specification for this slice:

- A single `PLOT_TICKET_PREFIXES` override value produces the same effective project scope in `issue-list --state inbox`'s JQL, `issueListInbox`'s own gate, and `issueOpen`'s project pick — assert this with a test that sets the override and checks all three agree, where today `issueListInbox`/`issueOpen` would still see the unoverridden `plot-config.sh` stub value and disagree.
- `issue-open` on a repository whose `Tracker` names a scheme no connector lists (e.g. `PLOT_TRACKER=linear`) exits 4 with `issue_source`'s `nobody` reason, not a raw "answers for jira and github-issues only" message derived from `tracker_scheme()` — the same shape the `PLOT_HOST=github PLOT_TRACKER=linear issue-list` regression test (if one exists for `issue-list`) already pins; write the equivalent for `issue-open`.
- No new site in `tracker-jira.ts` reads `plot-config.sh get "Ticket prefixes"` directly without going through the shared answer; grep for `PROJECTS_KEY` call sites in `tracker-jira.ts` and confirm there is exactly one read path feeding both `issueListInbox` and `issueOpen`.
- `packages/fleet/test/unit/issue-refresh.test.ts`'s `fakeHost` fixture (around line 43-90) still passes unmodified in its current shape — it already exercises the "no `Ticket prefixes`" vs "declared" split for the inbox read; if your change alters how `issueListInbox` asks for the key, update this fixture's `plot-config.sh` stub to match and say so in the PR body rather than loosening the test.

Plus the repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI and a failure there comes back as a correction — do not run the full e2e/contracts suites locally. Add a changeset (description first, `bumps:` block last, per `CLAUDE.md` § Versioning) naming package `plot` (this touches `skills/plot/scripts/plot-host.sh`) and/or `@plot-pm/board` if the domain/fleet packages are touched — check which `bumps:` keys apply. A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

This slice touches `plot-host.sh`, so `scripts/check-shell-lines.sh` applies: it refuses a PR whose shell under `skills/` is longer than at its merge base. Moving `issue-open`'s dispatch to call the existing `issue_source` helper should net-shrink or hold flat (reusing a helper, not adding a new `case`), but verify the line count against `git merge-base HEAD origin/main` before pushing; if it grows, remove an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section under `### Scope gate`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/adapters/tracker/tracker-jira.ts` (the `issueListInbox`/`issueOpen` project-key and issue-type reads), `skills/plot/scripts/plot-host.sh`'s `issue-open` op (the dispatch only — not `tracker_projects()`, `tracker_scheme()` or `issue_source()` themselves, which stay as the shared primitives other ops already call), and the tests for both.

Other branches in flight on this plan, verified 2026-10-16 against `origin/main`:

- `feature/the-jira-inbox-read-reports-truncation` — merged (#1893). It changed `packages/domain/src/adapters/tracker/tracker-shell.ts`, `packages/domain/src/entities/issue-index.ts`, and `packages/fleet/src/shared/issue-refresh.ts` — none of the files this slice owns, but rebase onto `main` to pick up its merge before starting, since both slices sit under `packages/domain/src/adapters/tracker/`.
- `feature/the-closed-set-answers-for-itself` and `feature/the-tracker-connector-paths-are-tested` (waves 3 and 4) are not yet started — no claimed branch exists for either as of this writing. Wave 4 ("Coverage": `tracker-fixture.ts` coverage, the issue-open budget record, a Jira 4xx on create) will likely touch `tracker-jira.ts` and `issue-open` tests too; if your PR lands first, say in the PR body which lines you added so wave 4 doesn't duplicate coverage for code you just changed.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
