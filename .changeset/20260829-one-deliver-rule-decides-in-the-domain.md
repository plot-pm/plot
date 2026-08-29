---
'@plot-pm/board': patch
'@plot-pm/domain': patch
---

The deliverable rule moves out of the board into `@plot-pm/domain`.

`allWavesMerged` — *has every one of this plan's non-deferred branches landed?*
— leaves `board.ts` for `rules/deliverable.ts`, taking its three-valued
`Landed` verdict with it. The verdict means nothing without the rule and the
rule means nothing without the verdict; they are one fact.

**Moving types alone would have left the rules where they are**, and the rules
are what the domain is for. This is the first of them.

**A move, not a re-implementation.** No second implementation exists at any
point. The board imports the rule and re-exports it, so `deliver.ts`,
`auto-deliver.ts` and `board.ts`'s own `planStatus` keep their import paths and
the review reads as the move it is. The re-export decides nothing — a wrapper
that only re-exports is fine, a wrapper that re-derives would be the defect.

**Two things the plan asserted that measurement contradicted**, both resolved
inside its own settled principles rather than around them:

The plan calls the rule *"already pure"*. It called `path.basename`, and the
domain's purity gate is a `grep` for `node:` that would have failed the build.
`basename` touches no disk, so the assertion was nearly right — but a gate that
admits `node:path` *because this one call is harmless* has a judgement call in
it, and the next import through that door will not be `basename`. Eight lines of
string arithmetic reproduce it instead, matching `path.basename` on all POSIX
inputs **including** the trailing-slash case a naive `lastIndexOf` slice gets
wrong. That branch is unreachable from a real plan path; it is covered so the
move is provably equivalent on all inputs rather than only on expected ones.

The rule's `meta` parameter was typed `PlanMeta` — the board's plan contract,
which cannot cross the boundary and should not. It read exactly one field.
The parameter now names that field and nothing else, and structural typing
makes the narrowing free: every call site passes a `PlanMeta` unchanged, no
cast anywhere. The old signature claimed a dependency on thirty fields to use
one.

**What proves behaviour is preserved: the board's existing tests, passing
unedited.** No test file on this branch was edited — `git diff main...HEAD --
packages/board/test` is empty. The dedicated
`merged-waves-reach-testing.test.ts` stays in the board and exercises the
re-export, which is the honest place for it: it builds its fixture from
`PlanMetaSchema`, which the domain neither has nor may import.

**Coverage was a gate here and it bit**, as the slice expected. The domain's
100% threshold failed the build on the newly-arrived module, and closing it
named two readings that nothing asserted before: an all-deferred wave sitting
*beside* a landed one carries the plan rather than refusing it, and the rule
trusts a wave's `verdict` over a branch state that disagrees with it. Both were
documented intentions with no test.

The rule keeps the name `allWavesMerged` and the domain keeps saying `Wave`
where it means `Slice`. That is a known defect with its own plan; renaming it
here would fuse two changes and break that plan's sequencing.
