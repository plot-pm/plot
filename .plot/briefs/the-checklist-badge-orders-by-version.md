## Implementation brief — the-checklist-badge-reads-the-newest-release

- **Plan (canonical):** docs/plans/2026-11-23-the-checklist-badge-reads-the-newest-release.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/the-checklist-badge-orders-by-version` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** `plot/review` through the review app, as for every PR here (`Review: pr`)

This plan has one slice and one wave. Nothing waits on it and it waits on nothing.

### What to build

The board's release-checklist badge counts the wrong file. `readChecklist` in `packages/board/src/server/board.ts` (line 787 on main; the plan says 782) lists `docs/releases/`, keeps names ending `-checklist.md`, calls `.sort()` and takes `.at(-1)`. `.sort()` orders text, so `v2.9.0-checklist.md` ranks after `v2.19.0-checklist.md`. Main holds `v2.1.0`, `v2.9.0` and `v2.19.0` checklists today, so the badge counts the 2.9.0 file. `vnext-checklist.md` wins today only because `n` sorts after `2`, not because a rule says so.

Build two changes:

1. Add `newestChecklist(names: readonly string[]): string | null` to the existing `packages/domain/src/rules/release-checklist.ts`. That file exists on main and already holds `listsOnChecklist`, `hasRcLine` and the checklist writer, so you append to it and create no file. The rule returns `vnext-checklist.md` when the list holds it, otherwise the `v<N.N.N>-checklist.md` name with the highest version by `compareVersions` (`packages/domain/src/entities/version.ts:47`), otherwise `null`. It ignores every other name. It is an arrow function with no I/O, and its TSDoc states what it returns and when it returns `null`.
2. In `readChecklist`, keep `readdirSync` and `readFileSync` and replace the `.filter(...).sort()` and `.at(-1)` lines with a call to `newestChecklist(fs.readdirSync(dir))`. Import it as a value from `@plot-pm/domain/rules/release-checklist`, the same subpath style `board.ts:30` uses for `rules/spike`. Leave `countChecklist` and `Board.tsx` alone.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**Use `compareVersions`, not `compareSemver`.** `version.ts` also exports `compareSemver`, which orders pre-releases. The rule filters names to exactly `vN.N.N` first, so both functions give the same order on every name that reaches them. The plan names `compareVersions`, which the release tag rule already uses. Do not switch.

**Match names with anchored patterns.** Keep `vnext-checklist.md` by equality and versioned names by `/^v(\d+)\.(\d+)\.(\d+)-checklist\.md$/`. Do not match `-checklist.md` as a suffix: `compareVersions` ranks a name it cannot parse as `0.0.0`, so `v2.19.0-rc.1-checklist.md` would rank below `v2.1.0` and still be eligible. The plan's open question `[question-rc-file-names]` recommends that the rule ignores a name it cannot order, and a test holds that. No such file exists on main.

**This narrows what the badge accepts, on purpose.** The old filter accepted any `*-checklist.md`, such as `notes-checklist.md`. The new rule ignores it. Only `vnext` and `vN.N.N` names are checklists. State this in the changeset.

**`vnext` ranks first by an explicit rule, not through the comparison.** `compareVersions('vnext', 'v2.19.0')` is negative (`vnext` parses as `0.0.0`). A rule that sorts all names with `compareVersions` and takes the last puts `vnext` first in the order, so it loses to every versioned name. Test `vnext` beside both versioned names for this reason.

**The domain decides and the board reads.** The file choice is a domain property (CLAUDE.md, *Every rendered state is a domain property*), so the unit test sits in the domain package. `readChecklist` keeps its `try`/`catch` returning `null`: a missing directory or an unreadable file gives no badge, never a guessed number.

**Out of scope, do not touch:** #1597 (the release gate reads the local checkout), #1605 (the `Released:` placeholder), #1501, #1669, #1682, and the operator's one-sprint trial of `vnext-checklist.md`. #1839 stays open after this PR; the PR answers #1609 only, so write `Refs #1839`, never `Closes`.

### Done when

The plan's slice tests are the specification:

- `newestChecklist` over `v2.9.0` and `v2.19.0` returns the `v2.19.0` name. This fails under text sort, the bug itself.
- `vnext-checklist.md` beside both returns `vnext-checklist.md`. This fails under "sort everything with `compareVersions`", the naive fix.
- A name that is not `vN.N.N` is ignored, including `v2.19.0-rc.1-checklist.md` and `notes-checklist.md`. Include one such name that would otherwise win, so the test fails if the filter is a loose suffix match.
- An empty list, and a list with no checklist name, return `null`.
- The result does not depend on input order. Run each case with the list reversed.
- A board test in `packages/board/test/board.test.mjs`, beside *reports a release checklist count, or null when there is none* (line 392), builds a repo whose `docs/releases/` holds `v2.9.0-checklist.md` and `v2.19.0-checklist.md` with different counts and asserts `board.checklist` equals the 2.19.0 file's count. Use different totals, so a wrong pick shows. `makeRepo` is in `packages/board/test/helpers.mjs:655`; read what it accepts before you plan the fixture. The board tests need the board artifact built first.

Domain tests go in `packages/domain/test/release-checklist.test.ts`, which exists and uses vitest.

Plus: a changeset in `.changeset/` for package `@plot-pm/board`, level `patch`, with the description first and the `plan:` line and any `bumps:` block last, in one HTML comment (CLAUDE.md, *Versioning*). The slice touches no skill, so it needs no `skills:` entry. Do not edit versions by hand. Do not commit a rebuilt `board-server.mjs` or any generated bundle: `scripts/check-no-bundle-diff.sh` refuses it.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` after you commit and before each push, and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. If that changes, growth is paid for in the same change.

Write functions you write as arrows. Leave `readChecklist` a declaration: you change two lines inside it, and rewriting it would only move its blame.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/release-checklist.ts`, `packages/domain/test/release-checklist.test.ts`, the one function `readChecklist` and its import line in `packages/board/src/server/board.ts`, `packages/board/test/board.test.mjs`, and one new file in `.changeset/`.

Other branches on origin at dispatch: `bug/a-new-failure-on-main-starts-a-repair`, `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts`, `bug/the-board-reader-reads-main`, `feature/the-main-reading-becomes-a-pr-status`, `docs/board-environment-and-remote-access`, `docs/config-comments-match-the-code`, `infra/root-entries-are-allow-listed`. I did not diff them. `board.ts` is a 3,000-line file several of them may touch, so expect to rebase, and take the conflict as a fact rather than a surprise.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
