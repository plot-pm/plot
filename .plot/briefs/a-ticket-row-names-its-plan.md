## Implementation brief — every-plan-reference-shows-its-issue (wave: Ticket rows)

- **Plan (canonical):** docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2994 merged
- **Branch:** `feature/a-ticket-row-names-its-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plot-review app required on `main`)

This slice waits only on `feature/a-plan-reference-is-decided-once` (PR #2996,
merged 2026-11-01T15:06:28Z) — the domain rule and `PlanReference` component it
calls. It does not wait on Rows (#3009, merged) or Panels (#3015), and nothing
in this plan waits on it. The Fleet index slice (`feature/the-fleet-payload-indexes-its-plans`)
is unrelated to this one's scope.

### What to build

The ticket row (`IssueRowView`, `packages/board/src/app/lib/agent-rows/rows.tsx:2846-2927`)
renders its plan slot (`rows.tsx:2889-2918`) as a `<TupleLinkView>` with a
hardcoded `href: ''` — always text, never a link, even for a ticket whose
issue a real plan already names. Measured 2026-11-02 (plan Design section,
paragraph "A ticket row names the plan its ticket already has"): every ticket
row shows the inferred name as plain text, also for a ticket whose plan has
already delivered, for example `two-test-teardowns-turn-main-red` (#3006).

`IssueRowView` is called from exactly one site, `AgentList.tsx:2570-2577`
(confirmed by grep — it is the Discovery tab's ticket lanes, not only the
no-plan "Waiting on you" inbox). That call site already has `onOpenPlan` and
`planIndex` in scope and passes them to its sibling rows, `DraftPlanRowView`
(`:2576`) and `PlanLevelRowView` (`:2591-2596`), but not to `IssueRowView`.
Wire the same two props through.

Build a domain rule that answers the reference a ticket row makes:

- Given the ticket's issue key and the board's `PlanIndex`
  (`packages/domain/src/rules/plan-reference.ts`), find the plan(s) whose
  resolved `issues` contain that key.
- A ticket with a resolved plan: pass `{ file, slug }` (or just `slug` — the
  index resolves the file) to `planReference`, so the row shows
  `<issue keys>: <slug>` and links `/plan/<file>`.
- A ticket with no resolved plan: keep today's `inferredPlanName(issue.title)`
  as the label, with the ticket's own issue number as the key and no file —
  `planReference({ issues: [issue.number] }, index)` with no `file`/`slug`
  resolves `href: null`, matching rule (ii)'s "no link where nothing resolves"
  case already proven in the Rule slice's domain tests.

**There is currently no path from an issue key to a plan's file/slug.** The
only existing issue→plan lookup is `ticketPlansOf` / `TicketPlan` in
`packages/board/src/server/fleet.ts:1737-1759` and
`packages/domain/src/rules/ticket-phase.ts:4` — and `TicketPlan` carries only
`{ state, total, merged }`, no `slug` or `file`. It feeds `ticketLane` /
`ticketPhase` (lane placement, phase badge), a different question from "which
plan, by name, does this ticket belong to". Do not repurpose `TicketPlan` for
this — it has no file or slug to add without breaking its one job, and
`IssueRowSchema` (`contract/schema.ts:3598-3677`) has no `plan`/`planFile`/
`issues` field either, confirmed by grep. The new rule reads the existing
`PlanIndex` (already keyed by file basename and slug, built client-side from
cards and drafts per the Rule slice) from the issue-key side: scan its entries
for one whose `issues` contains this ticket's key. This is a client-side
lookup over data the board already holds — no new server field, no `/api/fleet`
change, and no dependency on the Fleet index slice.

### Decisions already settled — do not re-derive them

- **The label and link come from `planReference`, not a new rendering path.**
  The Rule slice (merged) already proved every label/link shape this needs:
  one key, three keys, Jira keys, no-link-where-nothing-resolves, and the
  inferred-plan case. This slice's own tests are about wiring the right
  `ref` into `planReference`, not about re-testing its output shapes.
- **`href: ''` on a ticket with no plan is correct and stays.** Only the
  branch where a plan DOES exist for the ticket is wrong today. Do not turn
  every ticket row into a link — `inferredPlanName` with no href is the
  documented, deliberate shape for a proposal that does not exist yet
  (`rows.tsx:2890-2893`, "nothing to open... the plan does not exist, and
  that is the whole point of the row").
- **This is a client-side resolution, over the index the Rows/Panels slices
  already build and pass into `AgentList`.** The Fleet index slice (not yet
  started, waits on `feature/the-scan-script-is-a-launcher`) adds plan keys
  to `/api/fleet` only so the Delivery tab shows the prefix before
  `/api/board` lands — unrelated to ticket rows, which already run inside
  `AgentList` once the board payload is present. Do not block this slice on
  it, and do not add fields to `/api/fleet` here.
- **`AgentList.tsx:2570-2577` is the one call site.** There is no second
  `IssueRowView` caller to update (grepped `packages/board/src/app` for
  `IssueRowView`/`<IssueRowView`; the only non-definition hit is this call).

### Done when

The plan's `## Done when` table names two rows for this slice:

| Claim | Input | Expected |
|---|---|---|
| A ticket names its existing plan | ticket `3006` whose plan `two-test-teardowns-turn-main-red` is Delivered | label `3006: two-test-teardowns-turn-main-red`, href `/plan/<file>` |
| A ticket with no plan | ticket `42`, no plan | label `42: <inferred name>`, no link |

Both need a domain unit test (the lookup rule) and a row test (`IssueRowView`
rendering) per the table's Test column. Write the lookup rule's own domain
tests covering: a ticket with one matching plan, a ticket matching no plan,
and a ticket whose key matches a plan among several in the index (so the
match is by key, not by first-entry luck).

Remove the `href: ''` text-only arm's *hardcoding* and its stale-for-this-case
comment at `rows.tsx:2910-2912` ("the plan does not exist, and a link to one
that does not is the fabrication this board keeps removing") — rephrase it to
say that arm fires only when the lookup resolves nothing, since the plan can
now exist.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints — it maps your changed paths (`packages/board/src/**`,
`packages/domain/src/**`) to their related vitest runs and typechecks. List
no full suite. CI's `select` job runs the matching suites from the `CI
suites` config key on the PR; a failure there comes back as a correction.

`scripts/check-shell-lines.sh` only matters if this slice touches a `.sh`
file under `skills/` — it should not need to.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create`. Push the first real commit as soon as it exists —
`plot-open-pr.sh` refuses a branch holding no commit its base does not.

When the PR is created, append `→ #<number>` to this branch's line under the
plan's `### Ticket rows` slice heading (currently ends `<!-- waits:
feature/a-plan-reference-is-decided-once -->` with no PR annotation yet).

This plan also carries `Refs #3040` on this slice — #3040 is the tracker
issue for the stale "every ticket row shows no prefix" bug this slice fixes;
no action needed beyond what the plan already records.

### Scope guard

**This branch owns:**
- `packages/board/src/app/lib/agent-rows/rows.tsx` (the `IssueRowView` plan
  slot, `:2889-2918`)
- `packages/board/src/app/components/AgentList.tsx` (the `IssueRowView` call
  site, `:2570-2577` — adding `onOpenPlan`/`planIndex` props)
- The new issue→plan lookup rule, wherever you place it in
  `packages/domain/src/rules/` (a new file, or an addition to
  `plan-reference.ts` if the lookup belongs beside `planReference` itself —
  your call; name it for what it answers)
- `packages/board/test/unit/a-plan-row-names-its-ticket.test.ts` and/or
  `packages/board/test/integration/plan-row-names-its-ticket.browser.test.ts`
  (both already exist from the earlier, already-delivered
  `a-plan-row-names-its-ticket` plan — read them first; extend rather than
  duplicate if they already scaffold a ticket-with-plan fixture)
- A new domain test file for the lookup rule

**Other branches in flight, verified 2026-11-02:** `feature/a-plan-reference-is-decided-once`
(#2996), `feature/the-rows-name-a-plan-one-way` (#3009) and
`feature/the-panels-name-a-plan-one-way` (#3015) are all merged — their files
(`plan-reference.ts`, `PlanReference.tsx`, `tuple-row.ts`, most of `rows.tsx`,
`PlanCard.tsx`, `PlanModal.tsx`, `StoryModal.tsx`, `server/board.ts`) are
settled on `main` and not in motion. `feature/the-fleet-payload-indexes-its-plans`
(Fleet index) has not started and touches `contract/schema.ts` and
`server/fleet.ts` — this slice does not touch `server/fleet.ts`, so no
collision is expected, but confirm before pushing if that slice has since
started (`git ls-remote --heads origin feature/the-fleet-payload-indexes-its-plans`).

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
