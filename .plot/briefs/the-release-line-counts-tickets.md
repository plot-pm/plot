## Implementation brief — tickets-for-the-release-and-loose (wave: Tickets on the board)

- **Plan (canonical):** docs/plans/2026-11-08-tickets-for-the-release-and-loose.md on main
- **Design (canonical):** docs/superpowers/specs/2026-11-08-delivery-tab-design.md, approved 2026-11-08 — read "Section Content › Release delivery" and the bullet "One release line per target release"
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3250 merged
- **Branch:** `feature/the-release-line-counts-tickets` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This branch is the third of three in wave "Tickets on the board". It waits on `feature/delivery-tab-sections` (#3267, merged) and on the two slices of "Identity and reads" (#3254 and #3256, both merged 2026-11-08). Its siblings `feature/tickets-reach-input-to-the-fleet` and `feature/sprint-work-records-the-ticket-it-opened` run at the same time.

### What to build

The release line on the Delivery tab counts slices only: `deliveryView` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:403`) builds the string `N of M slices delivered · H held at gates · B blocked` from the placement, and no ticket reaches it. A person cannot see how many tickets of 2.32.0 are closed, how many are planned and how many nobody triaged. Add those three counts to the line.

Since #3256 the index holds what the counts need: `issues.json` rows carry `releases`, and `releaseOf(row, version)` (`packages/domain/src/rules/release-of.ts`) answers "planned for". `ticketLaneData` (`packages/board/src/server/fleet.ts:1956`) already hands the server the open rows (`entry.issueSets.rows`) and the closed rows (`entry.issueSets.closed?.rows`).

Two things do not exist yet, and measured on `origin/main` 2026-11-10 neither reaches the view:

1. **The target release.** `DeliveryMapInput` (`delivery-readings.ts`) carries no release and no ticket row. The sprint's `Release:` field is read in `board.ts:1873` and does not reach the Delivery mapping. Carry the active sprints' `Release:` values to the mapping.
2. **The count rule.** Write it as a pure domain rule, `packages/domain/src/rules/release-tickets.ts`, an arrow function over readings as values: the open rows, the closed set and the release version in, the three counts and the line's wording out. `delivery-view.ts` appends the wording and decides nothing.

### Settled decisions — do not re-derive them

**The board makes no second read.** The counts come from `issues.json` through the rows the server already holds. A `plot-host.sh issue-list` call from the board or from the rule is the duplicate the plan's Non-goals refuse, and it breaks the layering rule: a controller calls the domain and never spawns.

**The release is matched by exact name.** Use `releaseOf`. `2.32` does not match `2.32.0`. Do not add a milestone branch or a fix-version branch: the host script already emits one `releases` array for both trackers.

**The three counts, defined once.**
- *planned* = open rows where `releaseOf(row, version)` is true.
- *closed* = closed rows where `releaseOf(row, version)` is true.
- *untriaged* = open rows where `releases` is present and `[]`: the tracker was asked and named no release.

**Absent is not zero.** `releaseOf` answers `false` for a row with no `releases` as it does for `[]`, and that is right for a filter and wrong for a count. A row with no `releases` was never asked (Bitbucket, a repository with no tracker, a row written before index version 2). It counts as neither planned nor untriaged. Read `row.releases` itself for the untriaged count; counting every `!releaseOf` row turns each Bitbucket ticket into "untriaged". #3256's brief states the same three row states.

**The release line says when it did not read.** Three cases print no ticket count at all, and none prints `0`:
- no `issues.json`, or one that decodes to `null` (index version 1, unparseable): the line keeps its slice counts and omits the tickets;
- the tracker states no release on any open row (every row absent): omit the tickets, since all three counts would be a guess;
- the closed set is absent (no closed read has answered): print `planned` and `untriaged` and omit `closed`, never `closed 0`.

**The closed count is a window, not a total.** `issues.json` keeps closed rows for `ISSUE_INDEX_CLOSED_DAYS` (14) days, and `closed.complete` may be false. A release open for longer than 14 days loses its early closures from the set. Where `closed.complete` is not `true`, or the sprint began before the window's `since`, the wording says the count is partial (for example `closed 5+`). A naive implementation prints `closed 5` and understates the release silently. This is the brief's call: the plan names the three counts and not the window. Say so in the PR.

**Untriaged is not a count of the release's tickets.** By definition an untriaged ticket names no release, so it is the same number on every release line. Show it once per line as it is, labelled `untriaged`, and do not subtract or attribute it. The design's wording ("the release's tickets: closed, planned, and untriaged") is loose on this point; do not resolve it by inventing an attribution rule.

**One line per target release.** Where active sprints name different `Release:` values, each gets its line; two sprints naming the same value share one line. With no `Release:` target the ticket counts are hidden and the line stays as today (design, "One release line per target release"). Today there is one string, `DeliveryView.releaseLine`. Turning it into a list of lines is part of this slice. Keep the existing slice counts on it unchanged.

**Terminology is binding** (CLAUDE.md, "The Domain Package"). Write `Slice`, never `Wave`, where a slice is meant. New functions are arrows: `export const f = (…) => …`. Doc comments say what an export does and how it fails, with no history.

**Every rendered state is a domain property.** The counts and their wording come from the rule and are asserted in a unit test. The browser test proves only that the line shows them.

### Done when

The plan's `Done when` does not exist; its Changelog says *the release line counts the release's tickets: closed, planned and untriaged.* These assertions exist because a naive implementation passes without them:

- **Three states, three counts.** One fixture holds an open row with `releases: ['2.32.0']`, an open row with `releases: []`, an open row with no `releases`, and a closed row with `releases: ['2.32.0']`. The rule answers planned 1, untriaged 1, closed 1. Without the absent row, the test passes while Bitbucket tickets read as untriaged.
- **Exact name.** A row with `releases: ['2.32']` counts toward no line for `2.32.0`.
- **A closed row of another release is not counted.** Without it, every closed ticket of the last 14 days counts for the release.
- **Window.** `closed.complete: false` yields the partial wording; an absent closed set yields no closed count at all, not `0`.
- **Missing index.** A `null` index and an all-absent tracker print no ticket count, and the slice counts still print.
- **One line per release.** Two active sprints with `Release: 2.32.0` and `2.33.0` give two lines; two sprints with the same `Release:` give one; no `Release:` gives no ticket counts.
- **The browser test.** One test proves the line shows the three counts. Do not assert the arithmetic there.

Plus: no board bundle in the diff (`scripts/check-no-bundle-diff.sh`; `main` builds `skills/plot/scripts/board/board-server.mjs`). Run `pnpm build:board` only to test locally, then restore the generated paths before you push. Add `.changeset/the-release-line-counts-tickets.md` for package `plot` with the description FIRST and the `bumps:` block LAST, a `plan:` line inside the block (`.changeset/people-carry-a-tracker-identity.md` is the shape; `./scripts/check-changeset-packages.sh` refuses the other order).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`.

This slice touches no `.sh` file. If that changes, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, and the growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines.

### Bookkeeping

- Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section and push it to `main` (`Impl:` is own branches).
- Push the first real commit as soon as it exists.
- Read `.plot/state/fixer-attempts/<pr>.json` for `inFlight` before any hand fix of a PR.

### Scope guard

This branch owns:

- a new `packages/domain/src/rules/release-tickets.ts`, its export from the domain index, and its test
- `packages/board/src/app/lib/agent-rows/delivery-view.ts` (the line) and the one place that carries the target releases and the ticket rows into `DeliveryMapInput` in `delivery-readings.ts`
- the server read that supplies the sprint `Release:` values and the open and closed rows to the tab, built on `ticketLaneData`
- `AgentList.tsx` where `data-release-line` renders (`:1330`), the browser test for the line, and the `.changeset/` file

Siblings in flight, verified 2026-11-10 against `origin`: `feature/tickets-reach-input-to-the-fleet` owns the `ticket` item kind in `delivery-placement.ts` and needs the same two inputs (the target release and the ticket rows) in the same mapping; `feature/sprint-work-records-the-ticket-it-opened` owns the "opened by sprint" record. Keep out of `delivery-placement.ts`. Both this slice and `tickets-reach-input-to-the-fleet` add the ticket rows and the target release to `DeliveryMapInput`: whichever merges second rebases onto the first and reuses its field instead of adding a second one. If you reach a conflict on that field, report it rather than improvising.

Out of scope: placing a ticket under **You**, the Sprint filter, "opened by sprint" and the loose-end controllers — each is its own slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
