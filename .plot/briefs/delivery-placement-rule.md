## Implementation brief — every-work-item-and-agent-shows (wave: Rule)

- **Plan (canonical):** docs/plans/2026-11-08-every-work-item-and-agent-shows.md on main
- **Design (canonical):** docs/superpowers/specs/2026-11-08-delivery-tab-design.md, approved 2026-11-08
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3248 merged
- **Branch:** `feature/delivery-placement-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This branch is wave "Rule", the first of two. `feature/delivery-tab-sections` (wave "Tab") waits on it: the tab renders what this rule returns. Nothing waits on that branch, so this one owns the rule's shape. Plan 2 (row forms) and plan 3 (tickets, `People`, loose-end controllers) are separate plans and are out of scope.

### What to build

A domain rule in `packages/domain/src/rules/` that places every work item and every agent on the Delivery tab, from readings passed as values (`rule(readings, input)`: no port, no await, no spawn). It answers four things, and each answer is a property a unit test asserts:

- **Section of every work item**, once: **You** where a person must act first, otherwise **Work items**.
- **Section of every agent**, once: **Fleet**. The agent names the work item it acts on.
- **Both-way links**: a work item names the agent acting on it, and the agent links back to the item.
- **Group inside each section**: You › Input to the fleet, Review a result, Unblock. Work items › At a gate, Being built, Queued. Fleet › Working, Blocked, Free.

Lead with the failure it fixes, measured on the running board 2026-11-08: an agent row reading "waiting on you" sits under **Working**, and two idle desks reading "no manifest names this desk" sit under **Waiting on you**. The cause is that `GROUPS` (`packages/board/src/app/lib/agent-rows/sections.ts`) sorts rows by what they ask of a person, while rows reach a section by the state of one branch or one process. Work and actors share one list. A fix that re-sorts the same list reproduces the defect.

Machine and Release delivery are outside the placement rule. Release delivery is an overview scoped to the target release, and Machine is a reading of load and service limits. The rule may expose the section names, but it places no row in either.

The plan is canonical; this is orientation. Read the design's "The Placement Rule", "Section Content", "Groups" and "Calls Made After Review" before writing a test.

### Settled decisions — do not re-derive them

**An agent is blocked when it waits on any gate** (CI, review, the machine, a rate limit, a person), not only on a person. The design settles this on 2026-11-08. Reading "blocked" as "waiting on you" is the exact conflation the tab shows today.

**With `Auto-review: true`, a slice PR is a gate, not a review for a person.** It places under **Work items › At a gate**. **You › Review a result** holds only a release to approve, a delivered plan to test, and a PR in a repository without auto-review. A HIGH finding moves to **You › Unblock** only when the `Correction budget` is spent. A rule that sends every open PR to You re-creates today's overloaded section.

**A slice with a fixer retrying CI stays under Work items.** The worked example from the design: the slice shows as held at the CI gate, the fixer shows under Fleet as working on it, and the slice reaches **You** only when the fleet cannot continue (budget spent, or a gate it cannot pass alone). Test this case by name.

**You holds six named cases** and no others in this plan: a plan of mine in Draft or Design; an approval the lifecycle needs from a person (plan, spike, release); a `PLOT-BLOCKED` marker on a desk; a slice whose fixer budget is spent or whose gate the fleet cannot pass alone; a merge conflict no agent is assigned to; a slice whose agent died (today's *Quiet*), which carries a restart action. The seventh design case, "a ticket assigned to me that has no plan", belongs to plan 3, because tickets and `People` are not read today. Do not add a ticket reading here.

**You follows the board's Mine filter** (`packages/board/src/app/lib/agent-rows/mine-filter.ts`, three modes). The filter lives in the board app, so the rule takes "mine" as an input value rather than importing it. An item that needs another person places under **Work items**, so every item still shows once.

**A PR or branch that no plan names** (a release PR, a sprint branch, a hand-opened PR) places in the group of its state, with `PR` or `branch` as its kind. There is no *Unplanned* group.

**Delivered items leave Work items.** They belong to Release delivery, which this rule does not place. A delivered slice reaching Work items would be a second home for the same item.

**The rule reads what the board reads today** and nothing new: the pulse, the PR index, `issues.json`, the agent registry and the machine readings. A new data source is plan 3's scope.

**Terminology is binding** (CLAUDE.md, "The Domain Package"). A **Slice** holds one branch and belongs to one plan. Write `Slice`, never `Wave`, where a slice is meant. An **Agent** is the actor; `Worker` stays machine-side. A state answering "what is the process doing" goes on the worker, and one answering "what does this agent owe or hold" goes on the agent. New functions are arrows: `export const f = (…) => …`.

**Invariants this repo keeps re-learning:**

- Absent is not false. A reading the rule was not given places a row nowhere and says so; it does not default the row to Work items. `WaitingGroupSchema.nullable()` in `contract/schema.ts` exists for the same reason: *shown, never sorted*, and never filed under Done.
- A verdict is derived fresh from readings and is never persisted. The rule stores nothing.
- A decision made in a component is a defect. If a section, group or link target could be computed in `.tsx`, it belongs in this rule.

### The one open hazard: `GROUP_ORDER` and `GROUPS` must agree today

The plan says this slice replaces `GROUP_ORDER` (`packages/board/src/server/fleet.ts:5851`) and slice 2 replaces `GROUPS` (`sections.ts`). Two things hold them together now. `fleet.ts:7519` sorts rows with `GROUP_ORDER`, and `packages/board/test/unit/agent-list.test.ts:356` asserts `GROUPS.map(g => g.key)` equals `GROUP_ORDER`. If this branch removes or changes `GROUP_ORDER` and leaves `GROUPS` alone, that test fails, and the tab sorts rows by a vocabulary it no longer renders.

Do not resolve this by editing `GROUPS` (that is slice 2's file) or by loosening the test. Put the new group order in the domain as one exported constant. Change `GROUP_ORDER` only in a way that keeps the tab and that test green, and state in the PR body what the choice was. If no such way exists, write a `PLOT-BLOCKED` marker naming the conflict and stop. A person decides whether slice 2 absorbs the `GROUP_ORDER` change.

### Done when

The plan's `Done when` list is the specification. The plan has no separate list, so the specification is the placement design above. These assertions exist because a naive implementation passes without them:

- **Once-ness over a whole fixture.** One test builds a mixed estate (items, agents, a fixer on a failed-CI slice, a dead agent, a PR with no plan) and asserts every item and every agent appears exactly once across all sections. A per-case test passes while two cases double-place.
- **Both link directions on every acting pair.** For each item with an acting agent, the item names the agent and the agent links to the item. A one-way link passes every single-row test.
- **The fixer case by name**, as written under settled decisions: slice at the CI gate under Work items, fixer under Fleet › Working, slice absent from You.
- **Budget spent flips the same slice** to You › Unblock. This proves the boundary and not just the starting side.
- **Auto-review on versus off** for the same PR: At a gate versus You › Review a result.
- **Blocked on each of the five gates** places the agent under Fleet › Blocked, not only on a person.
- **A missing reading places nowhere** and does not default.
- **Group order is one constant**, asserted in a test that the tab's group list will later import. Slice 2 consumes it.

Rendered state is a domain property: each assertion above is a unit test in `packages/domain/test/`. Add no browser test in this branch. The one browser test that shows the sections belongs to slice 2.

Plus: the plan's Changelog and Board impact lines. The served payload does not change here, so a board artifact rebuild is not expected. Rebuild locally only to test, and restore generated paths before pushing (`scripts/check-no-bundle-diff.sh`). Add a changeset naming package `plot` or `@plot-pm/board` (description FIRST, `bumps:` block LAST; see CLAUDE.md "Versioning"), and run `./scripts/check-changeset-packages.sh`. A fleet agent runs `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and runs what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the new rule file and its tests under `packages/domain/`, plus the minimal `fleet.ts` change the hazard section allows. It does not touch `packages/board/src/app/lib/agent-rows/sections.ts`, `rows.tsx` or any `.tsx` file: those belong to `feature/delivery-tab-sections`. It does not touch the Tickets, Stories or Plans tabs, the fleet's scheduling, review, fix or merge behaviour, the tracker port, or the `People` config key. Collision check at dispatch: `git ls-remote --heads origin 'feature/delivery-*'` returned no other delivery branch, so no other branch in flight holds these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
