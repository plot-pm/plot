# Every plan reference shows its issue and opens the plan

> One domain rule decides how the board names a plan and where the name links, and one component renders that answer on every surface, so a reader can tell that two elements on the board name the same plan.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2993
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2994 merged
- **Started:** 2026-11-01, Jan Wloka, `feature/a-plan-reference-is-decided-once`
- **Started:** 2026-11-01, Jan Wloka, `feature/the-rows-name-a-plan-one-way`
- **Started:** 2026-11-01, Jan Wloka, `feature/the-panels-name-a-plan-one-way`

## Changelog

- Every element whose subject is a plan names it as `<issue keys>: <slug>`, for example `1090, 1091: a-plan-slug` or `EWZKUS-3430: a-plan-slug`, when the plan has issue keys, and as the slug alone when it has none. The plan's title is the tooltip.
- The issue prefix is never cut off. A slug that does not fit ends in an ellipsis and keeps at least 8 characters visible, and the tooltip and the accessible name keep the full text.
- Every reference to a plan that exists is a link to the board's `/plan/<file>` page. A reference that carries its own plan file, as every Delivery row does, links from that file at once, before the Planning payload arrives. A plain click opens the plan panel; a click with a modifier key or the middle button opens the page as the browser does. No reference opens a new tab by itself, and no reference links the git host.
- A reference that names no plan file and that the board cannot resolve, such as the inferred plan on an issue row, shows its issue prefix and no link.
- The Delivery tab shows the issue prefix on its rows while the Planning payload is still loading or has failed.
- A plan row on an `idea/<slug>` branch names its plan as `<issue keys>: <slug>` and links `/plan/<file>` from the first fleet payload, also before the fleet scan has read the plan on the branch. It never shows the branch name in the plan's place.
- The board builds a `/plan/` link in one place. `scripts/check-plan-routes.sh` fails a change that builds one anywhere else.

<!-- Board impact: yes. This plan changes how the board renders a plan reference: a new domain rule (packages/domain/src/rules/plan-reference.ts), one component, lib/tuple-row.ts, lib/agent-rows/, about ten components/*.tsx, and in slice 4 the /api/fleet contract and server/fleet.ts. A PR carries no generated bundle (scripts/check-no-bundle-diff.sh): main builds its own bundles after every merge. -->

## Motivation

The board shows one plan in several different ways. Ten sites build a `/plan/` link and about 14 sites render a plan's name, and each builds its own text and link. The plan head shows `1090: slug`. Branch, PR, agent and slice rows show the bare slug. The Planning card and the story modal show the title. Delivery rows and the sprint panel show the slug. The agent panel shows the file name. The plan-level verify, design and spec rows pass `issues: []` (`plan-level-row.tsx:168`), so the plan loses its number there even when it has one.

The open behaviour varies too: a click opens the plan panel, a button opens the plan panel, a click opens the `/plan/<file>` page in a new tab (`PlanLink` without `onOpenPlan`, `rows.tsx:372-374`), or the name is plain text with no link. Every link targets the board's own `/plan/<file>` route. No surface links a plan file on the git host (`git grep "blob/"` over `packages/board/src/app` finds nothing, measured 2026-11-01 by three jurors).

A reader cannot tell that two elements on the board name the same plan, because neither the label nor the link is consistent. `Card.issues` (`schema.ts:748`) and `DraftPlan.issues` (`schema.ts:4225`) carry a plan's issue keys. `AgentRow`, `Slice`, the plan-level rows, `SprintMember` and the agent panel do not. The story modal reads `Card` objects (`StoryModal.tsx:119`), not `StoryPlanRef`, so it has the keys already.

The user's two rules:

1. An element that refers to a plan with an issue always shows the issue prefix.
2. An element that refers to an existing plan is always a link that opens the plan.

The user also asked to remove the duplicate label and link helpers.

## Design

### Approach

**One domain rule decides.** `packages/domain/src/rules/plan-reference.ts` holds arrow functions with factual TSDoc. It takes readings as values, imports no port and awaits nothing (CLAUDE.md, "Every rendered state is a domain property").

- `planIndexOf({ cards, drafts, fleetPlans })` builds a `PlanIndex` keyed by file basename and by slug. Each entry is `{ slug, title, file, issues }`. Cards give `Card.slug`, `Card.title`, `Card.path` and `Card.issues`; drafts give `DraftPlan.issues` and their file; slice 4 adds the `/api/fleet` plan index as a third source. Every input is optional, so a caller passes the payloads it has.
- `planReference(ref, index)` answers `{ label, issues, title, href, exists }` for one reference. `ref` names the plan by `file` or `slug`, and may carry its own `issues` (the inferred plan on an issue row). The index entry wins over the reference's own keys when both exist.
- `issues` is normalised: each key becomes a string (`String(n)`, the form `issueKey` in `schema.ts:3572` uses), a leading `#` is removed, blank keys are dropped, and duplicates are dropped with the first order kept. A GitHub number prints as `1090` and a Jira key as `EWZKUS-3430`, as they are stored. The bare form matches the ticket row (`tuple-row.ts:1201`).
- `label` is `<keys joined by ", ">: <slug>`, or the slug alone with no keys. This is today's `planNameLabel` form (`tuple-row.ts:1278`).
- `href` is `planRoute(file)` when the reference carries its own `file`, or when the index resolves it to a file; else `null`. `exists` is `href !== null`. A reference with its own file therefore links before the index holds anything, as `planLink` does today from `row.planFile` (`tuple-row.ts:491`, `:1301`, `:1517`). The index only adds the issue prefix and the title when it resolves the reference. `href: null` remains only for a reference with no file that the index cannot resolve, for example the inferred plan on an issue row.
- `planRefOfRow(row)` answers the reference a fleet row makes: `{ file: row.planFile, slug: row.plan }` when the row names its plan, `{ slug }` for a `kind: 'plan'` row (an `idea/<slug>` branch) whose `plan` and `planFile` are empty, and `null` otherwise. The second arm exists because the server emits an idea row with `plan: ""` and `planFile: ""` until the fleet scan reads the plan on the branch. Measured 2026-11-01: the row for `idea/a-plan-that-joins-a-sprint` (plan PR #3000) read `plan: ""`, `planFile: ""` while its Planning card already held `path: docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md` and `issues: ["2999"]`. The row's slot 3 then fell back to `branchLink(row)` (`tuple-row.ts:685-700`, `name: plan ?? branchLink(row)`) and showed `idea/a-plan-that-joins-a-sprint` linked to the git host's branch page. With `planRefOfRow`, the index resolves the slug to the draft card, so the row shows `2999: a-plan-that-joins-a-sprint` and links `/plan/2026-11-01-a-plan-that-joins-a-sprint.md`. The rule reads no branch prefix: the server emits `kind: 'plan'` only for an idea branch (`tuple-row.ts:686-689`), so the slug is the branch name after its first `/`.
- While the index is not loaded, a Delivery row shows its slug as a link with no prefix, and the prefix appears when the index resolves. In slices 1 to 3 the index loads with `/api/board`; slice 4 (Fleet index) closes this gap, because the fleet payload then carries the keys.
- `planRoute(file)` returns `/plan/<encoded basename>`. It splits on `/` and `\`, so a Windows `Card.path` gives its basename (today's `planHref` case, `lib/plan.ts:13-16`).
- `planRouteOfDocLink(href)` rewrites a relative link inside a rendered document to its board route: a plan link (`../../plans/2026-08-16-slug.md`) to `/plan/slug.md`, and a story link (`../stories/<slug>/STORY-*.md`) to `/story/<slug>`. It returns any other link unchanged. It replaces the two copies of both regexes (`StoryModal.tsx:12-23`, story arm at `:18-22`; `server/board.ts:3182-3194`, story arm at `:3188-3192`), so a story link inside a rendered plan or story page keeps its route.
- The rule reuses `planLinkClick` (`rules/plan-link-click.ts:26`) for the click outcome. It does not restate it.

**One component renders.** `packages/board/src/app/components/PlanReference.tsx` renders a `planReference` answer and decides nothing.

- With `href`, it renders a real `<a href>`. Without `href`, it renders a `<span>`. It keeps the `data-tuple-link="plan"` and `data-tuple-text="plan"` hooks that 6 browser selectors in 5 files read, and adds `data-plan-ref`.
- The prefix is a `shrink-0` span and the slug is a `truncate` span with a minimum width of 8 characters (`min-w-[8ch]`), so a narrow column cuts the slug with an ellipsis and never the prefix, and two plans that share a key stay distinguishable by their first 8 slug characters.
- The `title` attribute holds the full label and the plan's title (`1085, 1086, 1101: slug — The plan's title`). The accessible name is `Plan <label>` (today's `linkLabel` form, `TupleRow.tsx:290-295`), so it starts with the visible text.
- A plain primary click, or Enter on the focused link, calls `onOpenPlan(file)`. When it returns `true`, the component prevents the navigation. A click with Cmd, Ctrl, Shift or Alt, or with another button, is not intercepted. The component never sets `target`.
- The reference carries its plan file. `TupleRow.tsx:414` stops decoding the file back out of the href.

**One open signature.** Every caller passes `onOpenPlan: (file: string) => boolean`, with the `planLinkClick` fallback in `App.tsx` (`onOpenPlanFile`, `App.tsx:924-936`). The `(card: Card) => void` callers (`Board.tsx:136`, `Swimlanes.tsx:17`, which hands it to `PlanCard` at `:244`), the `(planFile: string) => void` caller (`WorkerLogModal.tsx:108`, passed to `AgentPanelFacts` at `:319`) and the `(slug)` caller (`SprintModal`, `App.tsx:1588`) move to it. The story modal keeps its nested view: its own `onOpenPlan(file)` resolves the card and sets `viewingPlan`. The three `location.assign` fallbacks (`App.tsx:952`, `:965`, `:980`) call `planRoute`.

**A Draft plan opens its page.** The plan panel is built from a `Card`, and a Draft plan has none on the Planning payload (596 cards, all in Development, Testing or Released, measured by the safety juror). `onOpenPlan` therefore answers `false` for a draft once the board has loaded, and `planLinkClick` answers `navigate`: the anchor opens `/plan/<file>` in the same tab. This is the existing `navigate` arm, not a second open mode. The `wait` arm of `planLinkClick` and the pending-click path in `App.tsx` (`App.tsx:924-981`) stay live and in scope: a click on a Delivery row before `/api/board` arrives is remembered and opens the panel when the cards land, or falls back to `/plan/<file>` at the deadline or when the board is unreachable.

**Where the keys come from.** Slices 1 to 3 build the index on the client from the payloads the board already holds: the Planning cards and `fleet.draftPlans`. Measured on the saved payloads: 44 of 44 fleet rows with a `planFile`, 44 of 44 slices and 14 of 14 sprint members resolve to a card; 2 of 77 story refs do not. Slice 4 adds `plans: Record<slug, { file, issues }>` to the `/api/fleet` payload, built from the plan metas the server already reads in `referencedIssues` and `ticketPlansOf` (`server/fleet.ts:1562`, `:1638`), so it adds no parser run. In slices 1 to 3 a Delivery row links from its own `planFile` at once and shows the prefix when `/api/board` arrives. The Delivery tab then shows the prefix with its first fleet payload, before `/api/board` arrives (4.4 to 4.9 s, `App.tsx:123-146`) and while it fails. No per-row `issues` field is added to `AgentRow`, `Slice`, `SprintMember` or `StoryPlanRef`.

**What counts as a plan reference.** A plan reference is an element whose subject is a plan.

- In scope: the plan head (`rows.tsx:649`), a row's plan link in slot 4 (`planLink`, `tuple-row.ts:486`), the slice row's sole-plan link (`tuple-row.ts:1514-1519`), the plan row (`tupleFromPlan`, `tuple-row.ts:1294`), the plan-level verify, design and spec rows (`plan-level-row.tsx:168`), the draft row (`draft-plan-row.tsx:24`), the mixed-group heading (`AgentList.tsx:2162`), the unplaced rows (`AgentList.tsx:2694`), the story modal's plan list (`StoryModal.tsx:310`), the sprint members (`SprintModal.tsx:203`, `:213`), the agent panel's plan fact (`AgentPanelFacts.tsx:399`), the inferred plan on an issue row (`rows.tsx:2879`).
- The plan itself, not a reference: the Planning card heading (`PlanCard.tsx:373`) and the plan modal heading (`PlanModal.tsx:44-46`) keep the title as their heading and gain the issue prefix from `planReference`. Their `Open` anchors (`PlanCard.tsx:343`, `:498`, `PlanModal.tsx:45`) take their href from `planRoute`.
- Excluded, and it stays as today: a slice's own name stays text (`tupleFromSlice`, `tuple-row.ts:1474-1477`; three sibling slices must not show three links to one document). Text inside a control stays plain text with no anchor: the approve, needs-design, dispatch and menu buttons and their `title`s (`ApproveButton.tsx:69-72`, `NeedsDesignButton.tsx:29`, `StartWorkButton.tsx:331`, `menus.tsx:1316`), because an `<a>` inside a `<button>` is invalid nesting. A branch row inside a plan group, whose plan head one line up carries the reference, shows no plan link (`agents-tab.browser.test.ts:545-557` stays unchanged).
- The inferred plan on an issue row (a plan that does not exist yet) shows its issue number and no link. A reference that carries its own file links to it even when neither a card nor a draft resolves it, as rows do today; the `/plan/<file>` route answers for a file the server cannot find. A sprint member with no card keeps its `?` mark (`SprintModal.tsx:193-228`).
- Out of scope for the label: a link inside a rendered document body (story or plan markdown). Its text is the author's prose, and the board does not rewrite prose. Its href is in scope: `StoryModal` and `server/board.ts` call `planRouteOfDocLink`, so the duplicate regex goes. `server/board.ts` is not in the files of PR #2992, which merged on 2026-11-01.

**Two gates prove the two rules.**

- Rule (ii): `scripts/check-plan-routes.sh` greps `packages/board/src` and `packages/domain/src` for a `/plan/` href built from a template literal or a string join, with comments removed, and fails on any site outside `packages/domain/src/rules/plan-reference.ts`. Measured on `origin/main` 251b2abfc, 10 sites build one today: `lib/tuple-row.ts:491`, `:1301`, `:1517`; `lib/agent-rows/rows.tsx:372`; `lib/plan.ts:15`; `components/StoryModal.tsx:16`; `App.tsx:952`, `:965`, `:980`; `server/board.ts:3186`. The same slice removes the `` href={`/plan/ `` allowance from `ROW_NAVIGATION` (`test/unit/agent-list.test.ts:3398`).
- Rule (i): unit tests on `planReference` prove the label for every key shape. One browser test over a catalogue state proves that no surface prints a plan's name outside the component: it gives a plan the issue `1089`, collects every leaf element whose text contains that plan's slug or title, and asserts that each sits inside `[data-plan-ref]` or an excluded control, and that each reference starts with `1089: `. A grep cannot prove rule (i), because the sites that drop the prefix print raw fields (`{card.title}`, `{m.slug}`, `panel.plan`). Browser tests run in CI only (CLAUDE.md, Testing).

**What changes in existing tests.** Measured on `origin/main` 251b2abfc:

- 40 lines in 16 files under `packages/board/test` hold a `/plan/` string; 26 of them are single-quoted assertions in 11 files. The seams juror counted the same 26 assertions and 14 test files that name the helpers. Some of the 16 files test the server's `/plan/` route (`discovery.test.mjs`, `plan-source.test.mjs`, `tiny-garden.*`), and this plan does not change them.
- `test/unit/tuple-row.test.ts` has 37 lines on plan links (for example `:469`).
- `agents-tab.browser.test.ts:2469`, `:2474`, `:4810` assert exact `/plan/` hrefs; `plan-link-click.browser.test.ts` has 9 `/plan/` lines on the click contract; `plan-row-names-its-ticket.browser.test.ts:93` asserts `1089: one-ticket`.
- `test/unit/a-plan-row-names-its-ticket.test.ts:84-99` (`planNameLabel`) and `test/unit/plan.test.ts` (`planHref`, 6 assertions, Windows case at `:21`) move to `packages/domain/test/plan-reference.test.ts`. They are moved, not duplicated and not deleted.
- The catalogue browser test moves the count that `test/integration/stubbed-tests-start-no-board.test.ts:438-445` records; that slice updates the ledger.
- Each slice edits the tests its sites own, deliberately. A slice does not delete an assertion to get green.

**Data the tests must cover.** 298 of 596 cards carry issue keys and 28 carry two or three (`a-desk-and-its-manifest-name-each-other` carries `1085, 1086, 1101`). Two plans share issue 1090 (`a-slice-nobody-worked-on-reads-not-started`, `a-start-step-leaves-no-claim-and-no-desk`), so the slug, not the prefix, tells them apart. Known limit: a narrow column can cut both slugs. The slug keeps a visible floor of 8 characters (`a-slice-` against `a-start-`), and the full label is in the tooltip and the accessible name. Two plans that share a key and the first 8 slug characters look alike in a column that narrow.

**Stale comment.** `tuple-row.ts:1326` says a gate asserts *"One import, and it is the contract's types"*. `tuple-row.ts:19` already imports `@plot-pm/domain`, and no test greps those imports. The Rows slice corrects the comment, so it does not read as a constraint on calling `planReference`.

### Decisions

Decided 2026-11-01 by the operator after panel round 1 (`.plot/panels/every-plan-reference-shows-its-issue/panel.md`):

- [x] **Name:** the slug with the issue prefix, `1090, 1091: slug`, with keys as stored (GitHub numbers, Jira keys). The title is the tooltip and part of the accessible description. The prefix is never truncated; the slug truncates with an ellipsis. All four jurors chose the slug: it is the identity that rows, branches, slices, the sprint file and the route share, so a reader can match two elements; a title is longer and truncates first. The safety juror's `first key +N` form is not taken: the prefix stays whole and the slug gives way down to a floor of 8 visible characters.
- [x] **Link target:** the in-app `/plan/<file>` route as a real anchor. A plain click opens the plan panel through one `onOpenPlan(file) => boolean`; a modified click keeps browser behaviour. No surface links the git host. All four jurors found that no surface links the git host today, so this standardises the open mode, not the target. A git-host link fails for a plan that is not pushed (`Card.notPushed`), for a Draft before its push, and on a host whose URL shape the board does not know.
- [x] **Issue keys:** the domain decides. `planReference` and `planIndexOf` take the index as a value. Slices 1 to 3 build the index on the client from cards and draft plans. Slice 4 adds a plan index to `/api/fleet`, so the Delivery tab shows the prefix while `/api/board` is slow or `null` (layering juror, finding 1). Slice 4 waits on slice 3 and on the plan walk's last slice, `feature/the-scan-script-is-a-launcher`. Evidence, read 2026-11-01: #2992 (`feature/scan-once-walks-in-process`) merged at 2026-11-01T11:51:11Z and edits `packages/board/src/server/fleet.ts`. The walk plan (`2026-10-31-the-plan-walk-moves-into-the.md:97-113`) names no files for its four later slices, none of them has a PR, and `feature/the-walk-caches-by-oid` carries only its claim commit (790b7ae4a). No evidence shows that those slices leave `fleet.ts` alone, so slice 4 waits on the last one.
- [x] **Scope:** a plan reference is an element whose subject is a plan. A slice's own name, text inside a control, and a branch row under a plan head that carries the reference are excluded (safety juror, findings 1 to 3).
- [x] **Gates:** `scripts/check-plan-routes.sh` for rule (ii); unit tests on the rule and one catalogue browser test for rule (i) (testability juror, findings 1 and 2).
- [x] **The server's document-link rewriter** (`server/board.ts:3182-3194`) is in scope for its href and out of scope for its text, as stated in the Approach.

### Open Questions

- [x] Which name does a reference show: the title, the slug, or both? The slug with the issue prefix; the title is the tooltip.
- [x] Which link target is the standard: the in-app plan panel, or the plan file on the git host? The in-app `/plan/<file>` route, opened in the plan panel on a plain click; no surface links the git host.
- [x] Does each payload carry the plan's issue keys, or does the client resolve them from the card through one shared lookup? One domain rule over a plan index: built on the client from cards and drafts, and carried on `/api/fleet` from slice 4.

## Slices

### Rule

- `feature/a-plan-reference-is-decided-once` — `packages/domain/src/rules/plan-reference.ts` with `planIndexOf`, `planReference`, `planRoute` and `planRouteOfDocLink`, exported from the package index; `packages/board/src/app/components/PlanReference.tsx` with its own unit test; `packages/domain/test/plan-reference.test.ts` with every domain row of the test table, including the `planNameLabel` cases from `a-plan-row-names-its-ticket.test.ts:84-99` and the Windows case from `plan.test.ts:21`. No site migrates and no helper is deleted. <!-- builds: planReference domain rule and the PlanReference component --> → #2996

### Rows

- `feature/the-rows-name-a-plan-one-way` — the tuple and agent rows render through `PlanReference`: `planLink` (`tuple-row.ts:486`), `tupleFromPlan` (`:1294`), the slice row's sole plan (`:1514-1519`), the plan head and `PlanLink` (`rows.tsx:354-380`, `:649`), the inferred plan (`rows.tsx:2879`), the plan-level rows (`plan-level-row.tsx:168`, `issues: []` goes), the draft row (`draft-plan-row.tsx:24`), the server-emitted idea row (`tuple-row.ts:685-700`, through `planRefOfRow` in `packages/domain/src/rules/plan-reference.ts`, so `name: plan ?? branchLink(row)` loses its branch fallback for an idea row), the mixed-group heading (`AgentList.tsx:2162`) and the unplaced rows (`AgentList.tsx:2694`). `AgentList` receives the plan index. `TupleLink` carries the plan file and `TupleRow.tsx:414` stops decoding the href. Corrects the comment at `tuple-row.ts:1326`. Deletes `planLink`, `planNameLabel`, the slice row's inline href, the duplicate href in `tupleFromPlan`, `PlanLink`'s `target="_blank"` mode, and the moved tests in `a-plan-row-names-its-ticket.test.ts:84-99`. Edits `tuple-row.test.ts` and the browser assertions on plan labels it owns. A row that carries its own plan file keeps its link before `/api/board` loads, so `plan-link-click.browser.test.ts:97-140` passes unchanged and this slice does not edit it. <!-- waits: feature/a-plan-reference-is-decided-once --> → #3009

### Panels

- `feature/the-panels-name-a-plan-one-way` — `PlanCard` and `PlanModal` headings gain the prefix and their `Open` anchors call `planRoute`; `StoryModal` lists its plans through `PlanReference` and calls `planRouteOfDocLink` instead of `rewritePlanLink`; `server/board.ts:3182-3194` calls `planRouteOfDocLink`; `SprintModal`, `AgentPanelFacts`, `WorkerLogModal` (`:108`, `:319`) and `Swimlanes` (`:244`) take `onOpenPlan(file) => boolean`; `Board.tsx:136` moves from `(card)` to `(file)`; the `App.tsx` fallbacks at `:952`, `:965`, `:980` call `planRoute`. Adds `scripts/check-plan-routes.sh` and a step that runs it in `.github/workflows/ci.yml`, beside the other `scripts/check-*.sh` steps (for example `Plan headings say Slices`, `ci.yml:1666-1667`), removes the `` href={`/plan/ `` allowance from `ROW_NAVIGATION` (`agent-list.test.ts:3398`), adds the catalogue browser test and updates the ledger in `stubbed-tests-start-no-board.test.ts:438-445`. Deletes `planHref` (`lib/plan.ts:13`), `rewritePlanLink` (`StoryModal.tsx:12`), `rewritePlanLinks` (`server/board.ts:3182`) and the moved `planHref` assertions in `plan.test.ts`. <!-- waits: feature/the-rows-name-a-plan-one-way --> → #3015

### Fleet index

- `feature/the-fleet-payload-indexes-its-plans` — `/api/fleet` carries `plans: Record<slug, { file, issues }>`, an optional field in `contract/schema.ts`, built in `server/fleet.ts` from the metas `planMetasOf` already returns to `referencedIssues` and `ticketPlansOf`. The Delivery tab passes it to `planIndexOf` as `fleetPlans`. A contract test asserts that every fleet row's and slice's plan has an index entry. <!-- waits: feature/the-panels-name-a-plan-one-way, feature/the-scan-script-is-a-launcher, bug/an-issue-reads-its-plan-from-main --> <!-- builds: a plan index on the fleet payload -->

## Done when

Each row names the test that proves it. Domain rows run in `pnpm --filter @plot-pm/domain exec vitest run test/plan-reference.test.ts`; board unit rows in `pnpm --filter @plot-pm/board exec vitest run`; browser rows in CI.

| Claim | Input | Expected | Test | Slice |
|---|---|---|---|---|
| Rule (i): no keys | slug `a`, no issues | label `a` | domain unit | Rule |
| Rule (i): one key | issues `['1089']` | label `1089: a` | domain unit | Rule |
| Rule (i): three keys | issues `[1085, '1086', '#1101']` | label `1085, 1086, 1101: a`, keys `['1085','1086','1101']` | domain unit | Rule |
| Rule (i): Jira key | issues `['EWZKUS-3430']` | label `EWZKUS-3430: a` | domain unit | Rule |
| Rule (i): duplicate and blank keys | issues `['1090', '', '1090']` | keys `['1090']` | domain unit | Rule |
| Rule (i): index wins | ref keys `['1']`, card keys `['2']` | label `2: a` | domain unit | Rule |
| Rule (i): draft plan | a `DraftPlan` with issues `['7']`, no card | label `7: a`, href `/plan/<file>` | domain unit | Rule |
| Rule (ii): resolved by file | card with `path` `docs/plans/a b&c.md` | href `/plan/a%20b%26c.md`, `exists: true` | domain unit | Rule |
| Rule (ii): Windows path | `path` `docs\plans\x.md` | href `/plan/x.md` | domain unit (from `plan.test.ts:21`) | Rule |
| Rule (ii): resolved by slug | ref slug only, card present | href from the card's file | domain unit | Rule |
| A reference with its own file links before the index | ref file `gone.md`, empty index | label `gone`, href `/plan/gone.md`, `exists: true` | domain unit | Rule |
| No link where nothing resolves | ref slug `gone`, no file, empty index, keys `['5']` | label `5: gone`, href `null`, `exists: false` | domain unit | Rule |
| Inferred plan | ref with issues `['42']`, no file | label `42: <inferred name>`, href `null` | domain unit | Rule |
| Document link rewrite | `../../plans/2026-08-16-slug.md`; `https://x/y` | `/plan/slug.md`; unchanged | domain unit | Rule |
| Story link rewrite | `../stories/a-story/STORY-a-story.md` | `/story/a-story` | domain unit | Rule |
| The prefix is never truncated | three-key plan in a narrow column | prefix span `shrink-0`, slug span `truncate`, `title` holds label and title | component unit | Rule |
| Two plans sharing a key stay distinguishable | `a-slice-nobody-worked-on-reads-not-started` and `a-start-step-leaves-no-claim-and-no-desk`, both issue `1090`, narrow column | slug span `min-w-[8ch]`; `title` and accessible name hold the full label | component unit | Rule |
| Accessible name starts with the visible text | any resolved reference | accessible name `Plan <label>` | component unit | Rule |
| A plain click opens the panel | click, `onOpenPlan` returns true | `onOpenPlan(file)` called, default prevented | component unit | Rule |
| A modified click keeps browser behaviour | Cmd, Ctrl, Shift, Alt, middle button | `onOpenPlan` not called, no `target` | component unit | Rule |
| Every row projection shows the prefix and the link | `tupleFromRow`, `tupleFromSlice` sole plan, `tupleFromPlan`, plan-level, draft row, fed issues `['1089']` | label `1089: <slug>`, href `/plan/<file>` | `tuple-row.test.ts` | Rows |
| An idea row before the scan reads its plan | `planRefOfRow` and `tupleFromRow` over a `plan` row, branch `idea/a`, `plan: ""`, `planFile: ""`, draft card `a` with `path` `docs/plans/2026-11-01-a.md` and issues `['7']` | ref `{ slug: 'a' }`; label `7: a`, href `/plan/2026-11-01-a.md`, no branch name in slot 3 | domain unit and `tuple-row.test.ts` | Rows |
| An idea row with no card yet | the same row, empty index | label `a`, href `''`, branch kept in slot 4 | `tuple-row.test.ts` | Rows |
| A slice's own name stays text | `tupleFromSlice` | name href `''` | `tuple-row.test.ts:469` unchanged | Rows |
| A plan-level or branch row links before `/api/board` loads | `/api/board` held back, click on the plan-level row's link | the link exists, the click waits, and the panel opens when the board lands | `plan-link-click.browser.test.ts:97-140` unchanged | Rows |
| The prefix appears once the index loads | fleet row with `planFile`, no cards, then cards with issues `['1089']` | first `<slug>` with href `/plan/<file>`, then `1089: <slug>` with the same href | board unit over `planIndexOf` | Rows |
| A grouped branch row has no plan link | plan group with branch rows | 0 plan links in the branch row | `agents-tab.browser.test.ts:545` unchanged | Rows |
| Panels show the prefix | `PlanCard`, `PlanModal`, `StoryModal`, `SprintModal`, `AgentPanelFacts` fed issues `['1089']` | prefix `1089: ` | component units | Panels |
| A sprint member with no card is text | member slug with no card | text with the `?` mark, no link | `SprintModal` unit | Panels |
| Rule (ii) gate | a `/plan/` href built outside the rule | `scripts/check-plan-routes.sh` exits 1 and names the file and line | the `.github/workflows/ci.yml` step plus a contract test that feeds it a fixture | Panels |
| Rule (i) over the catalogue | catalogue plan with issue `1089` | every element showing its slug or title sits in `[data-plan-ref]` or an excluded control, and each reference starts with `1089: ` | catalogue browser test | Panels |
| The Delivery tab shows the prefix without `/api/board` | fleet payload with `plans`, board payload `null` | plan head and rows show `1089: <slug>` | board unit over `planIndexOf({ fleetPlans })` | Fleet index |
| Every fleet plan has an index entry | the saved fleet payload | each row's and slice's plan is a key of `plans` | contract test | Fleet index |
| The duplicate helpers are gone | the tree after slice 3 | no `/plan/` href outside the rule; `planLink`, `planNameLabel`, `planHref`, `rewritePlanLink` and `rewritePlanLinks` have no definition | `scripts/check-plan-routes.sh` and `pnpm run typecheck`, which fails on an import of a deleted helper | Panels |

## Notes

Review: plot-review on 941c0e4aa found HIGH 1, MEDIUM 1 and LOW 3. This amendment answers each: a reference with its own file links before the index (HIGH), `planRouteOfDocLink` keeps the story arm (MEDIUM), the Panels slice adds the CI step, the slug keeps an 8-character floor, and slice 4 waits on the walk's last slice (LOW).

Created from tracker issue #2993 (https://github.com/plot-pm/plot/issues/2993). The issue says `PlanLink` without `onOpenPlan` opens "a GitHub file in a new tab". That is false: it opens the board's own `/plan/<file>` route in a new tab (`rows.tsx:372-374`). This plan corrects the claim and removes the new-tab mode.

A related, already-released plan, `2026-10-17-a-planned-issue-shows-its-plan.md`, writes `plan:*` labels and a link comment on the tracker issue. It does not render a plan reference on the board. The two plans are complementary. The domain already has a `planLink` in `ports/tracker.ts` and `rules/plan-issue-comment.ts` for that tracker comment; the Rows slice deletes only the board's `planLink` at `lib/tuple-row.ts:486`.

Order with `an-issue-shows-its-plan-s` (#2997): its slice `bug/an-issue-reads-its-plan-from-main` changes `planMetasOf` (`server/fleet.ts`) to read the plan directory at `origin/<default>`. The Fleet index slice builds its plan index from the same function, so it waits on that slice.

Known limit: the `title` tooltip appears on mouse hover only. A keyboard user who focuses a truncated reference does not see the full slug; a screen reader announces it through the accessible name.

Known limit: a `/plan/<file>` route matches by basename (`server/board.ts:3102`, `:3113`), so a same-named file on two sources opens the first one the server finds. No two cards share a basename on the saved payloads.
