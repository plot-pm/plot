# Round 1: moderation

**Subject:** `docs/plans/2026-10-02-a-draft-slice-waits-on-its-approval.md` (#1161, Draft), as committed in `f766f2b2`. The jurors read it on `origin/main` at `508abec3` (skeptic) and `5da3e923` (operator, domain). The moderator re-verified every cited line on `385d6d7d`.

**Gate:** `unanimous amend skeptic,operator,domain`

## What each juror executed and what each read

| Juror | Executed | Read |
|---|---|---|
| skeptic | A scratch vitest file that calls the exported `classify` for `draft` and `approved` × all 8 `BranchState` values × age `null`/5/5000, plus `blocked`/`waiting`/`unknown` with a `running` worker. 51 rows, recorded in `out.tsv`. | The plan, #1161, `fleet.ts`, `entities/fleet.ts:54-63`, `schema.ts:1588`, `eligible.ts:107`, `vitest.config.ts:71`, `fleet.test.ts:970-980`, `working-agents.ts:109`. |
| operator | One `/api/fleet` read on the live board. | The plan, #1161, `classifyGroup` arms, `localActivity`, `schema.ts:1588`, `eligible.ts:107`, `verdict.ts:60`, `sections.ts`, `AgentList.tsx:1465-1500`, `menus.tsx`. |
| domain | Nothing. | The plan, #1161, `classifyGroup` arms (`:5054`, `:5137`, `:5146`), `classify` (`:5446`), the three phase files, #1150's plan. |

Only the skeptic's table is a measurement of the rule. The operator's live read measures the payload, not the rule. The domain juror's findings are readings, and the skeptic's table confirms each one that the table covers.

## The measurement

The skeptic's table shows that a Draft plan places in NOT STARTED for `blocked`, `waiting` and `unknown` at every age, and for `claimed` and `wip` at age 5. A Draft `open` or `deferred` branch places in WAITING ON YOU. A stale `claimed` or `wip` branch places in WAITING ON YOU with its abandonment note. A `running` worker places every measured state in WORKING.

## Agreed changes (all three jurors)

1. **The invariant is false for paths the rule leaves alone.** A Draft plan's `claimed` and `wip` branch within the quiet window (`fleet.ts:5053`, `:5145`) and any branch that reaches `localActivity` (`:4683` for `open`, `:5056` and `:5148` for `claimed` and `wip`) still return `not-started`. The Changelog line and the issue's third Done-when cannot both hold. Each juror offered the same two options: narrow the invariant, or extend the rule.
2. **The "every BranchState" test passes or fails on its fixture defaults.** With age `null` and no worktree it passes vacuously. With age 5 it fails after the fix. The test must name its fixtures.
3. **`classifyGroup` is not exported.** The tests call `classify` (`:5446`).

## Changes raised by one or two jurors

- `fleet.test.ts:956-980` asserts that `draft` equals `approved` for `wip` at age 5, so the plan cannot move `wip` without that edit (skeptic).
- Say whether `draft-placement.ts` is exported from `packages/domain/src/index.ts` (skeptic).
- `deriveSlices` (`fleet.ts:4026`, `section` at `:4032`) gives every incomplete slice `not-started`. Name its effect on the plan head (skeptic).
- The Changelog must say that a later slice loses its `waits for …` sentence until approval (operator).
- The moved row's Open item links to a branch with no remote ref. Name it out of scope (operator).
- State the #1150 outcome for a Draft slice that an agent holds, and add a test (domain).
- `:5122` is `:5123` (domain).
- The issue's `shelved` is the `deferred` state (skeptic).

## Disagreements

None on position. One on emphasis: the operator measured that one live row moves today, not 15, because `5da3e923` approved sixteen plans. The skeptic and the domain juror read the 15 rows as the scope. Both readings are true. The rule is the same in either case, so the count changes no requirement.

On the invariant, no juror chose between narrowing and extending. The moderator records the choice as open for the amendment.

## Shared blind spot

No juror ran the rule against a Draft `open` branch held in a local worktree, although the operator and the domain juror named that path. The skeptic's fixture has no worktree. No juror ran `withHandOver`, because it is not on `origin/main`: the #1150 interaction is read from that plan's prose only. No juror checked whether a plan head reaches the `slicesElsewhere` section fallback. Both call sites (`AgentList.tsx:1667`, `:2000`) pass the `here` set, so the fallback that reads `deriveSlices`' `section` is not reached from a plan head.

## What an amendment changes

The amendment extends the rule to the complete form: a Draft plan's `claimed` and `wip` branch within the quiet window, and any Draft branch with local activity, also place in WAITING ON YOU. The invariant then holds for every state. The amendment rewrites the two `fleet.test.ts` cases that assert draft equals approved for `wip` at age 5, pins the sweep test's fixtures, names `classify` and the index export, names `deriveSlices` a non-goal with the reason above, states the lost `waits for …` sentence, settles the #1150 order with a test, and corrects the line numbers. A round 2 would test the amended rule against a held worktree and against the sweep's cross product.
