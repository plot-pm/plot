## Implementation brief — a-sprint-view-says-what-it-hid

- **Plan (canonical):** `docs/plans/2026-09-29-a-sprint-view-says-what-it-hid.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session (after panel round 1, one juror, amend)
- **Branch:** `bug/a-sprint-view-says-what-it-hid` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #1058 (reported from a Bitbucket estate on Plot 2.21.0)

The plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

With «Sprint only» on and sprint `1-8-leg` selected, the reporter saw four PRs that no sprint member names (`#1056`, `#1091`, `#1103`, `#1104` — the last is the sprint's own PR) and a section header reading «6 hidden by Sprint only» that does not include them. The filter exempts plan-less PRs on purpose, and nothing on screen says so, so an operator cannot tell *exempt* from *broken*.

Build two things in `packages/board/src/app/components/AgentList.tsx`:

1. **A per-row mark** on every row the sprint filter exempted, so the reader can tell the exempt row from a member row while looking at it.
2. **A count of the exempted rows**, taken in the same pass as the filter at `AgentList.tsx:533-541`, reported where the filter reports — on the «Sprint only» control, beside the way «Only my work» reports `N rows hidden` (`:855-863`).

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**No row is hidden that is shown today.** The exemption stays. `#1104` is the sprint's own PR and `#1103` may be the dependency bump the sprint needs; hiding them makes «Sprint only» omit work an operator must act on. `plot-reconcile-scan.sh` makes the same call for plan-less merged PRs (8 of 18 measured belonged to a sprint with no plans yet). Do not change `slugPassesSprintFilter` (`lib/filters.ts:283`) and do not touch the `release` exemption's behaviour.

**A count alone does not discharge the report.** An earlier draft offered count, mark or both and its slice built only the count. With four exempt rows among dozens, «4 shown without a plan» still leaves the reader scanning every row. The mark is required.

**The count goes on the control, not in the section header.** `hiddenCount` (`:966-969`) is per SECTION; the reporter's «6 hidden» was one section's number. A global number beside a per-section one reads as a pair over two populations. `mineOnly` already reports globally on its own control and prints `0 hidden` rather than suppressing it — that is the precedent.

**The exemption is not «rows with no plan».** The comment at `:538` is wrong. The predicate is `kind === 'release'`, or `kind === 'pr'` with `plan === ''`. `rowKind` in `packages/board/src/server/fleet.ts` is ordered, so:

- `fleet.ts:5918` — `if (conflicts) return 'branch';` sits above the `pr` arm. A plan-less PR that **conflicts** becomes a `branch` row and is **hidden** — `sprint/1-8-leg` vanishes the moment it conflicts.
- `fleet.ts:5903` — `carriesDraftPlan` → `'plan'`. An `idea/*` PR awaiting approval is hidden.

`slugPassesSprintFilter('')` against a selected sprint returns `false`, so every plan-less row of kind `branch`, `plan`, `ticket`, `build` or `agent` is already hidden. **The slice decides** whether to widen the exemption to those two cases (widening shows rows hidden today, which the «no row hidden that is shown today» assertion permits) or to record them out of scope in the plan **with the consequence named**. It may not leave the plan both forbidding the view and leaving it standing. Fix the `:538` comment either way.

**`hiddenCount` is contaminated by the ownership filter.** `rows` descends from `visibleRows = rowsForReader(filteredRows, reader, mineOnly)` (`:556`), while `unfilteredSectionedRows` is `rowsBySection(fleet.rows)` (`:933`). Executed: 3 rows, 1 visible, suffix «2 hidden by Sprint only» — one hidden by sprint, one by `mineOnly`. The comment at `:546-551` states the opposite as a rule. **Fix the denominator** (compare against `rowsBySection(rowsForReader(fleet.rows, reader, mineOnly))`, or equivalent) **or record in the plan** that the new count hangs beside a wrong one. The first is cheap and is the expected answer.

**Three populations never reach the filter.** `brokenRows` (`:434` area), `draftRows` and `filteredIssues` (`:572`, `= fleet.issues`; issues carry no sprint field) come from `fleet` directly and feed WAITING ON YOU's `countOf` (`:983-987`). Name them in what the view says — at minimum the wording must not claim the section's tally was sprint-filtered.

**No payload change.** `r.plan === ''` and `r.kind` are already on the wire. Adding a schema field triggers the six-touchpoint capability ceremony for nothing.

**Carried invariants.** A decision is a domain property, not a `.tsx` computation: if the exempt predicate becomes a named function, put it in `lib/filters.ts` beside `slugPassesSprintFilter` and unit-test it there, so the row mark and the count read one predicate rather than two copies. New functions are arrows.

### Done when

The plan's `## Done when` list is the specification. The assertions a naive implementation would pass without:

- **A fixture carrying BOTH a member plan row and an exempt PR row**, asserting the mark is on the exempt one and not on the member. A fixture with only exempt rows passes a mark rendered on every row.
- **No row hidden that is shown today** — a regression assertion over the current exempt set (`release`, plan-less `pr`) with the filter on.
- **The count names its population** — global, not per section — and a `0` is printed rather than suppressed, like `data-mine-hidden`.
- **Wording distinguishes exempt from hidden** — «N hidden» and «N shown without a plan» are separate phrases; a test asserts both can appear together.
- **If the denominator is fixed:** a fixture with `mineOnly` on and one row hidden only by ownership, asserting the section suffix does not count it. No test asserts the «hidden by Sprint only» suffix today, so this assertion is new, not a rewrite.
- **The conflicted plan-less PR and the `idea/*` draft PR**: either a test proving they now show, or the plan's Notes recording them out of scope with the consequence.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:board` (rebuilds `skills/plot/scripts/board/board-server.mjs` — commit the rebuilt artifact), `pnpm run typecheck`. Browser tests load the built artifact, so run `pnpm build:board` before them. Do not run `test:e2e` locally. A changeset with `'@plot-pm/board': patch`, description first.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `PR: #<number>` inside the slice heading in the plan: `### A sprint view says what it hid (Branch: bug/a-sprint-view-says-what-it-hid, PR: #N)` — a trailing `→ #N` does not parse on a heading-form slice.
- Any decision on the conflicted/`idea/*` cases or the denominator that is recorded rather than fixed goes into the plan's Notes in the same PR.

### Scope guard

This branch owns `packages/board/src/app/components/AgentList.tsx`, `packages/board/src/app/components/SprintFilter.tsx`, `packages/board/src/app/lib/filters.ts`, their tests under `packages/board/test/`, the rebuilt `board-server.mjs`, one changeset, and the plan file's Slices heading and Notes. Touch `packages/board/src/server/fleet.ts` only if the slice widens the exemption and that cannot be done client-side — prefer the client, since `rowKind`'s order serves other sections.

In flight at dispatch (verified 2026-09-29): `bug/a-sprint-item-names-a-plan-or-says-it-has-none` changes `board.ts`, `entry/sprint-transition.ts`, the sprint template and the board artifact — no source overlap; the artifact conflicts are resolved by rebuilding (`-merge`). `bug/a-state-sweep-is-one-request` carries one commit; the other open `bug/*` refs carry none.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
