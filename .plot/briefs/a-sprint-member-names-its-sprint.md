## Implementation brief — a-plan-that-joins-a-sprint (wave 4: Gate)

- **Plan (canonical):** docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3000 merged
- **Branch:** `feature/a-sprint-member-names-its-sprint` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review required on main)

This branch is the plan's last wave before Repair. It waits on all three prior waves — Membership rule (PR #3002), Approve and deliver (PR #3005), Writer (PR #3013) — and all three are merged, so this branch is eligible now. The Repair slice (`bug/the-delivery-loop-sprint-is-repaired`) waits on this one only transitively (it waits on Approve-and-deliver and Writer, not on Gate), so it does not block starting here, but the plan's "current sprint is repaired through the new code" claim should not be run until this gate exists — it is what proves the repair commit is clean.

### What to build

A gate that refuses a commit adding or moving a sprint member line onto an open sprint (Planning/Committed/Active) when the plan's `- **Sprint:**` field disagrees with `sprintOfPlan`'s answer over the new tree. Two call sites, one rule:

1. **Commit-time**, as a new row in `GATES` (`packages/board/src/server/entry/gate.ts`), beside `stateGate` (`:299`) — add `sprintMemberGate` and register it at `:996` next to `stateGate`. It reads staged text the same way `stateGate` does via `effectivePaths` (`gate.ts:310`, `:355`, `:495`, `:551` — follow that import/call shape, don't invent a second way to read staged content).
2. **CI**, as a PR-only step in the `checks` job (`.github/workflows/ci.yml:951`), after "Build the board bundles" (`:1051-1052`), gated the same way "A PR carries no bundle" is (`:1039-1041`): `if: github.event_name == 'pull_request'`. It runs a new launcher `scripts/check-sprint-members.sh`, which calls `plot-sprint-member.mjs check --base <merge base of origin/main and HEAD>`.

### Decisions already settled — do not re-derive them

**The domain rule already exists and is already correct for this.** `packages/domain/src/rules/sprint-membership.ts` exports `sprintOfPlan(slug, sprints)`, `sprintsListing(slug, sprints)`, and `memberLineIndex(content, slug)`. The membership-test function is named `unstruckSprintMembers`, not `sprintMembers` as the plan prose says — the plan's prose is aspirational naming, the merged code is the actual export. Write `sprint-member-gate.ts` against `unstruckSprintMembers`, `sprintOfPlan`, `sprintsListing`, `memberLineIndex` — all four already exported from the package index, confirmed present.

**The writer (`add|defer|remove`) exists with no `check` verb.** `packages/board/src/server/entry/sprint-member.ts:77` types `verb: 'add' | 'defer' | 'remove'` and `:91-92` refuses anything else with `"expected a verb 'add', 'defer' or 'remove', got '...'"`. Adding `check` means widening that union and the validation, and giving it its own argument shape (`--base <sha>` instead of `<sprint> <slug>`) — this is not a fourth branch bolted onto the existing dispatch at `:274-276`, it's a structurally different command (reads a diff, not a single plan+sprint pair) that happens to share the entry file and bundle name. Read `run` (`:181`) fully before deciding how `check` plugs in; don't assume it slots into the existing `if (args.verb === 'add')` chain unchanged.

**"Added or moved" has a precise definition already worked out in the plan** (Design § "The gate reads only what a commit adds"): a slug is added-or-moved when it's in the new tree's `unstruckSprintMembers` result and either wasn't in the old tree's, or was there under a different tier. A tick, an annotation, a Deferred line, and a struck line are explicitly NOT additions/moves — don't refuse on those. Get this test-table row right first (`sprint-membership.test.ts` already has the membership primitives tested; the gate's own added-or-moved diffing is new and is the core logic bugs will hide in).

**Only open sprints are read at all.** A sprint file is read by the gate only when its new `State:` is Planning, Committed or Active — Closed sprints are never checked, even if a commit adds a member line to one. This is why the historical 77 disagreements (all in Closed sprints) never trip the gate.

**A slug with no matching plan file passes silently.** `plot-reconcile-scan.sh` section 9 already reports an unplanned sprint member read-only — the gate is not a second reporter for that case, it only acts when the slug does resolve to a plan and that plan's field disagrees.

**Refusal shape**, per the plan: name the plan, the sprint, the line to write, and the fix command — `plot-sprint-member.mjs add <sprint> <slug> --tier <tier>`. The commit-time form prints to stderr; the CI form uses a GitHub `::notice::` line for the non-refusing drift case (field set to a sprint that doesn't list the plan — that's reported, never refused, per Decisions and Out-of-scope).

**Never runs on push to `main`.** The `if: github.event_name == 'pull_request'` condition is load-bearing: it's what keeps a bypassed commit-time hook from turning `main` red and triggering `default-branch-red`'s merge-queue hold. Don't widen this condition "for safety" — a red main from this gate is explicitly the failure mode the plan designs around.

**The replay numbers are the regression fixture.** The plan's Design section already measured: replayed over 321 non-merge commits touching `docs/sprints/` since 2026-10-01, the rule refuses exactly 19 lines in 13 commits (all scope-change commits with an empty field at the time, including `b1df72cf1` and `fc06f0678`), and refuses **zero** of the 191 approve/deliver commits in that range. `test/reconcile/sprint-member-gate.test.mjs` replays the real commits `b1df72cf1`, `fc06f0678` (must refuse), `ab0ab107b` (must pass — field agrees), `d1c9e7eeb` and `f57425ec0` (must pass — ticks, not additions). If your implementation refuses any of the passing commits or admits either refusing commit, the logic is wrong, not the fixture.

### Done when

The plan's `## Done when` table rows for the "Gate" slice are the specification (16 rows, from "The writer's commit passes the gate" through "Today's estate passes"). Two worth flagging because a naive implementation passes without them:

- **"Removing the check fails a test"** — a deliberate mutation-testing row: mutate `sprintMemberRefusals` to return `[]` and confirm the `b1df72cf1`/`fc06f0678` replay rows fail. Do this for real before calling the slice done; it's the only row that proves the test suite would actually catch a regression in the gate logic itself, not just exercise it.
- **"Gate ignores drift a commit did not add"** — an existing member with an already-wrong field, where the commit touches a *different* line in the same open sprint, must pass. Easy to get wrong if the diff logic checks "does any member in the new tree disagree" instead of "does any newly-added-or-moved member disagree."

Plus: the repo's gates — `node skills/plot/scripts/board/plot-local-checks.mjs` resolved relative to the repo root, run before each push; run what it prints. `pnpm --filter @plot-pm/domain exec vitest run` for the domain test, `pnpm --filter @plot-pm/board exec vitest run` for any board-side test, `node --test test/reconcile/sprint-member-gate.test.mjs` for the contract replay. List no full suite — `test:e2e` is CI's gate, not a local one.

`scripts/check-shell-lines.sh` ratchets shell line count against the merge base. `scripts/check-sprint-members.sh` is a new shell file — it must be a launcher only (resolve the bundle, `exec` it, decide nothing), matching the existing pattern other `check-*.sh` launchers use, and its line count is new shell added in this change. If the ratchet complains, remove an equal number of lines elsewhere in this same change rather than writing logic into the shell file.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller once ready:

```bash
../plot/scripts/plot-open-pr.sh          # current branch, ready
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. Once the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` → `### Gate` section (currently has no `→ #N` annotation).

### Scope guard

This branch owns:
- `packages/domain/src/rules/sprint-member-gate.ts` (new) + `packages/domain/test/sprint-member-gate.test.ts` (new)
- the `sprint-member` row in `GATES` (`packages/board/src/server/entry/gate.ts`)
- the `check` verb of `packages/board/src/server/entry/sprint-member.ts` (widens the existing `add|defer|remove` entry)
- `scripts/check-sprint-members.sh` (new launcher) and its PR-only step in `.github/workflows/ci.yml`
- `test/reconcile/sprint-member-gate.test.mjs` (new contract test replaying the four real commits)

All three prior-wave branches are merged to `main` already — no collision risk with in-flight siblings. The Repair slice (`bug/the-delivery-loop-sprint-is-repaired`) has not started; it touches only `docs/sprints/2026-W44-delivery-loop.md` and nothing this branch touches, but it should land after this gate exists so its own commit passes it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
