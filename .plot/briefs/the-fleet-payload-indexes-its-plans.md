## Implementation brief — every-plan-reference-shows-its-issue (wave: Fleet index)

- **Plan (canonical):** [docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md](../../docs/plans/2026-11-01-every-plan-reference-shows-its-issue.md) on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2994 merged
- **Branch:** `feature/the-fleet-payload-indexes-its-plans` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `## Plot Config`'s `Review app` (plot-review on the PR)

This is the plan's last slice. Its three waits are all merged on `main`: `feature/the-panels-name-a-plan-one-way` (#3015), `feature/the-scan-script-is-a-launcher`, and `bug/an-issue-reads-its-plan-from-main` (#3003) — the last one changed the exact function this slice reads from. Nothing blocks this branch starting now.

### What to build

`/api/fleet` gains `plans: Record<slug, { file, issues }>`. The domain side already exists and is unused: `packages/domain/src/rules/plan-reference.ts` defines `PlanIndexFleetPlan` (`{ file, issues }`) and `planIndexOf`'s `sources.fleetPlans` arm, with the comment "Unused until the payload carries it." This slice is what makes it used — wiring the source, not inventing the shape.

1. In `packages/board/src/server/fleet.ts`, build the plan index inside `buildFleet` (around the existing `Promise.all` at `:7748` — add it to that same concurrent group, it is one more read riding the `entry` already in scope) from `planMetasAtDefault(opts, entry)` — the same function `ticketPlansOf` already calls at `:1713`. Each `PlanMeta` has `.file` and `.issues`; key the record by the plan's slug (`PlanMeta` carries a slug field — check its shape in `fleet.ts` near `PlanMetaSchema`, do not recompute it from the filename).
2. Add `plans: z.record(z.string(), z.object({ file: z.string(), issues: z.array(z.string()).default([]) })).optional()` to `FleetSchema` in `packages/board/src/contract/schema.ts`, beside `draftPlans` (`:4593`) and `registry` (`:4604`) — optional, following the `registry` precedent in the same block, so a client talking to an older server still validates.
3. On the client, `packages/board/src/app/components/AgentList.tsx:364` already calls `planIndexOf({ cards: cards ?? [], drafts: fleet?.draftPlans ?? [] })`. Add `fleetPlans: fleet?.plans ?? {}` to that call. Check the other four call sites found live in the tree (`App.tsx:1142`, `StoryModal.tsx:102`, `rows.tsx:32`'s `EMPTY_PLAN_INDEX`, `tuple-row.ts:24`'s `EMPTY_PLAN_INDEX`) — the Delivery tab is the one this plan names explicitly (Decisions, "Slice 4 adds a plan index to `/api/fleet`, so the Delivery tab shows the prefix while `/api/board` is slow or `null`"), so confirm which of those five is the Delivery tab's actual render path before deciding whether more than one needs the new source.

### The decisions the plan settles — do not re derive them

- **Why the index is built from `planMetasAtDefault`, not a fresh read.** The plan's Decisions section is explicit: "Slice 4 adds a plan index to `/api/fleet`, built from the plan metas the server already reads in `referencedIssues` and `ticketPlansOf`, so it adds no parser run." `referencedIssues` is gone (deleted by `bug/an-issue-reads-its-plan-from-main`, already merged) — the live caller to match today is `ticketPlansOf` at `fleet.ts:1713`, which calls `planMetasAtDefault(opts, entry)`. Call the same function with the same `entry`, not a second parse: `planMetasAtDefault` already caches by the resolved `origin/<default>` oid (see its own doc comment), so a second call in the same render is cheap, but a reimplementation that reads the working tree directly would cost the full parse this plan measured at ~780 ms and would silently diverge from `ticketPlansOf`'s answer.
- **Why this waited on `bug/an-issue-reads-its-plan-from-main` specifically.** The Notes section states the order and why: "`bug/an-issue-reads-its-plan-from-main` changes that source, so it merges first." It replaced `planMetasOf`'s body with `planMetasAtDefault`, which reads `origin/<default>` instead of the local working tree. Building this slice against the old `planMetasOf` would have been rebuilt work; it already merged, so build against `planMetasAtDefault` directly — do not reintroduce a working-tree read.
- **Optional field, not required.** Follow the `registry` field's precedent (`schema.ts:4600-4604`): the server emits it unconditionally once this slice lands, but the schema stays `.optional()` so an older client or server pairing does not break validation. Do not make it `.default({})` the way `draftPlans` is `.default([])` — check which precedent fits; `registry` is the closer analogy because, like `plans`, it is metadata about a read rather than a list the client always needs a value for.
- **Slug keying, not file-path keying.** `planIndexOf`'s existing code (`plan-reference.ts`, the `fleetPlans` loop) reads `Object.entries(sources.fleetPlans ?? {})` and treats each key as the slug directly (`add(indexEntry(slug, '', plan.file, plan.issues))`). The record's keys must be slugs, matching what the Rule slice already committed to — this is not a free choice on this branch.
- **No per-row `issues` field.** The plan's Approach section states this explicitly: "No per-row `issues` field is added to `AgentRow`, `Slice`, `SprintMember` or `StoryPlanRef`." The index is the only new carrier of issue keys on the fleet payload; do not add `issues` to any row type as a shortcut.

### Done when

The plan's `## Done when` table names two rows for this slice:

- "The Delivery tab shows the prefix without `/api/board`" — fleet payload with `plans`, board payload `null` → plan head and rows show `1089: <slug>`, proved by a board unit test over `planIndexOf({ fleetPlans })`.
- "Every fleet plan has an index entry" — the saved fleet payload → each row's and slice's plan is a key of `plans`, proved by a contract test.

Write both. The second is a contract test (not a unit test) because it is checking the server's actual emitted payload against the rows and slices in the same payload — a real fixture, not a hand-built one.

Plus: `scripts/check-plan-routes.sh` must keep passing — this slice adds no new `/plan/` href construction, so it should be unaffected, but confirm it stays green since the slice touches `AgentList.tsx`, a file that gate greps. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite in the PR body.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice is TypeScript-only per its plan line (`contract/schema.ts`, `server/fleet.ts`, `AgentList.tsx`) — it should touch no `.sh` file, so this gate should cost nothing. If a shell file ends up touched, that growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Do not run `gh pr create` — it takes its title from the last commit subject rather than the plan's wave heading, and has caused mis-titled PRs before. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `### Fleet index` heading, currently the only slice line with no PR number yet).

### Scope guard

This branch owns: `packages/board/src/contract/schema.ts` (the new `plans` field only — do not touch unrelated schema fields), `packages/board/src/server/fleet.ts` (the `buildFleet` function and the new plan-index builder), and `packages/board/src/app/components/AgentList.tsx` (the `planIndexOf` call site at `:364`, plus whichever of the other four call sites turns out to need `fleetPlans` per the investigation above).

Do not touch `packages/domain/src/rules/plan-reference.ts` — `planIndexOf`, `PlanIndexFleetPlan` and the `fleetPlans` arm are already built and merged by the Rule slice (#2996). This slice is a caller, not a second builder.

No other branch of this plan is in flight — Rule (#2996), Rows (#3009), Panels (#3015) and Ticket rows (#3046) are all merged, and this is the plan's last slice. The only overlap risk is `fleet.ts`'s own churn: the plan's Notes section on the sibling plan `an-issue-shows-its-plan-s` measured 24 commits to that file in the week before 2026-11-01. Rebase on `origin/main` immediately before opening the PR and again before any review-driven push, per that plan's own warning about this file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
