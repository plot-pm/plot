---
'@plot-pm/board': patch
'@plot-pm/domain': patch
---

One deliver rule, and it decides in the domain.

The deliverable measurement leaves `packages/board/src/server/board.ts` for
`@plot-pm/domain` as `src/rules/deliverable.ts`. It is the first *rule* in a
package that until now held only entities — the entity graph moved first
because a rule with nowhere to stand had to wait for one.

**It is named `allSlicesMerged`, because that is what it asks.**
`DESIGN-slice.md` settled on 2026-08-28 that a Slice holds exactly one branch
and belongs to one plan, while a Wave is the fleet's cross-plan cohort, formed
at dispatch and persisted nowhere. This rule walks one plan's slices. The old
name said Wave and meant Slice, and an earlier attempt (**PR #511**) moved the
same logic under it and was closed rather than merged for exactly that reason:
merging it would have grown the defect, and `Entities` and `Transitions` would
have been built on top of it.

**The board keeps compiling, and no board test was edited.** `board.ts`
re-exports the domain rule under the name its two external call sites still use
(`deliver.ts`, `auto-deliver.ts`), marked in one line as temporary; renaming
those sites is a separable change. Its own internal call site in `planStatus`
reads the domain name directly, because a re-export is a module binding and not
a local one — `tsc` named that site, which a grep would not have.

**The board's four existing suites are what prove the behaviour survived.**
`merged-waves-reach-testing.test.ts`, `auto-deliver.test.ts`,
`deliver-route.test.ts` and `plan-status.test.ts` — 81 tests — pass unedited
through the re-export. They could not have moved: they build fixtures with
`PlanMetaSchema.parse`, the board's plan contract, which the domain neither has
nor may import.

**14 new cases cover the rule at the domain boundary**, reading it through the
narrow `{ file }` it declares, and meeting the package's 100% threshold on 16
of 16 branches. The gate fails the build when unmet, so the coverage is a
measurement rather than a claim.

**The parameter is `PlanFile`, not `PlanMeta`.** The old signature claimed a
dependency on thirty fields — phase, sprint, story, assignee, PR numbers,
transition records — to read one. The domain could not import that type in any
case; the module resolver refuses, which is the point of the boundary.
Structural typing keeps the narrowing free, so no call site casts.

**The three house rules hold, and the vocabulary gate's `allowed=` is not
raised.** The new file adds zero occurrences of the counted misuse (the count
stays at 10 against an allowed 12), declares no `function`, and carries factual
TSDoc: what each export does, its parameters, its return, its failure modes.
The reasoning #511 kept in 109 lines of comment above 28 lines of code is in
the commit message instead, where it is dated and `git log -S` finds it —
including the two measurements worth keeping, the 2026-08-27 timeout read as a
negative and the 2026-08-20 plan with no merged slice that read as delivered.
