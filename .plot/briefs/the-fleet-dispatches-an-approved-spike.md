## Implementation brief — the-fleet-writes-the-design (slice: The spike dispatches)

- **Plan (canonical):** [docs/plans/2026-10-12-the-fleet-writes-the-design.md](../../docs/plans/2026-10-12-the-fleet-writes-the-design.md) on `main`
- **Approved:** 2026-10-13, jwloka, plan-PR #1608 merged
- **Branch:** `feature/the-fleet-dispatches-an-approved-spike` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This is the plan's first slice and the smallest: it starts no new agent, touches no new file, and nothing in the plan waits on it by name (only slice-heading order places it first — the panel's round-1 revision moved it ahead of the other three precisely because it is small and low-risk). The other three slices (*What the fleet reads*, *The spec run*, *The button goes*, *The spec rows*) do not depend on this branch's output; they can proceed concurrently.

### What to build

Today, automatic dispatch only ever starts branches of an `approved` plan. Six sites in `packages/domain/src/rules/auto-dispatch.ts` each gate on the literal filter `if (plan.phase !== 'approved') continue;`, at lines **531, 582, 617, 656, 733, 798** — confirmed unchanged at the current commit. This slice relaxes those filters so a `design`-phase plan is admitted into the same machinery, and leaves the actual eligibility decision entirely to `sliceVerdict` (`packages/domain/src/rules/eligible.ts`), which already (merged via #1634, already on `main`) admits exactly one slice of a Design plan: the spike, once `Spike approved:` is recorded, and only when that slice names the spike alone (`spikeAdmitted`, `eligible.ts:127-134`). You are not writing new eligibility logic — you are widening six admission gates so `sliceVerdict`'s existing, narrower decision becomes reachable for Design plans.

The five domain-side functions to change, each presently keyed to `'approved'` only:

1. `planAutoDispatch` (`:531`) — the budget planner. Admit `design` plans too; `wave.verdict !== 'eligible'` still filters out every non-spike slice underneath.
2. `startableBranches` (`:582`) — the spawn-side mirror of (1). Must stay in lockstep with it (see the doc comment above it: *"a second spelling... is a second place for the two to disagree"*).
3. `skippedClaimedBranches` (`:617`) — the `ref_held` reporter.
4. `firstBrieflessBranch` (`:656`) — picks the branch to hand the `Brief command`.
5. `dispatchCandidates` (`:798`) — the full candidate set `findMissingBriefs` checks against.

`skippedPlans` (`:733`) is the one site that is **not** a blanket widen: the plan's text is explicit that it "admits a `design` plan only when it has an eligible slice" — i.e., a Design plan with no approved spike must **not** enter the `no-eligible-wave` reporting line that `packages/fleet/src/shared/auto-dispatch.ts:368-373` prints on every pulse (that would be noise: a Design plan with no spike yet isn't a dispatch candidate going stale, it's just not approved yet). Read the existing `:733` filter and its surrounding accounting (`unstartable`/`held`/`flying`/`noBrief`/`eligibleBranches`) closely — the `eligibleBranches === 0 → no-eligible-wave` arm already requires an eligible slice to exist before anything is reported, so confirm by test whether this site needs any code change beyond widening the phase check, or whether the existing `eligibleBranches` accounting already yields the right behavior once `design` is admitted. Write the Acceptance test for this ("a Design plan with no approved spike is not in `skippedPlans`") first, and let it tell you.

On the fleet side, two `hasEligible` reads in `packages/fleet/src/shared/auto-dispatch.ts` (**lines 243 and 282**) use the identical `p.phase === 'approved' && p.slices.some(w => w.verdict === 'eligible')` test, gating whether a deferral or at-cap refusal is worth logging. Widen both the same way, so a spike waiting at the cap is named instead of silently absorbed into "nothing eligible."

### The decisions the plan settles — do not re-derive them

**No new eligibility rule.** `sliceVerdict`'s `spikeAdmitted` branch is already merged and already correct — it is not part of this slice's diff. Your whole job is admission filtering upstream of it. Resist any temptation to duplicate the spike check in `auto-dispatch.ts`; the single source of truth stays in `eligible.ts`.

**Widen the phase check, don't replace it.** The six domain-side sites and the two fleet-side reads change from `plan.phase !== 'approved'` (or `=== 'approved'`) to a check that also admits `'design'`. Do not drop the phase check entirely — a plan in `draft` or any other phase must still be excluded, since `sliceVerdict` itself only computes a verdict for slices of plans whose phase is checked elsewhere in the readings pipeline.

**`skippedPlans` carries an extra condition the other five don't.** This is the one site where "widen the filter" is necessary but may not be sufficient — see above. Do not copy the same one-line diff across all six sites without checking this one against its own Acceptance case.

**This slice starts no new agent and adds no new rule.** It is pure plumbing: six filters widened, zero new files, one existing rule (already on `main`) becomes reachable. If your diff grows beyond touching `auto-dispatch.ts` (domain), `auto-dispatch.ts` (fleet) and their test files, you have likely drifted into a sibling slice's scope — stop and check against *Scope guard* below.

### Done when

Per the plan's `## Acceptance`, first bullet (*Spike dispatch*, exercising Changelog item 1):

> `packages/domain/test/auto-dispatch.test.ts`: a Design plan whose spike is approved and briefed gets `max: 1` from `planAutoDispatch` and appears in `startableBranches`; with no brief, `dispatchCandidates` names it, `firstBrieflessBranch` returns it, `skippedPlans` reports it `no-brief` and `planAutoDispatch` starts nothing; an unapproved slice of the same plan is in none of the branch answers, and a Design plan with no approved spike is not in `skippedPlans`.
>
> `packages/fleet/test/unit/auto-dispatch.test.ts`: a briefless approved spike reaches `missingBriefs` and the `Brief command` is asked.

Each clause above is a distinct test case — write them as separate assertions, not one combined fixture, so a future regression names exactly which function broke. The "an unapproved slice of the same plan is in none of the branch answers" clause is the guard against over-widening: a Design plan with an approved spike AND an ordinary unapproved slice must still report only the spike.

Plus: the repo's gates. No bundle diff (`board-server.mjs` is generated — never hand-commit it; this slice shouldn't touch it, since it's a pure domain/fleet change with no board surface). A changeset for `plot` is very likely not needed here since this touches `packages/domain` and `packages/fleet` source, not a skill — check `## Versioning` in `CLAUDE.md` for which package name applies to a domain/fleet-only change (likely none needed unless a skill-facing behavior changed; if genuinely unsure, a changeset targeting no skill bump is safe to omit). `scripts/check-shell-lines.sh` is a no-op here — no `.sh` file changes. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — for `packages/domain/src/**` and `packages/fleet/**` changes that resolves to `pnpm --filter @plot-pm/domain exec vitest related --run`, `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`, and `pnpm --filter @plot-pm/fleet exec vitest related --run` plus `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`. The suites in `CI suites` (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest run with coverage, `test/reconcile/*.test.mjs`) run in CI on every PR — do not run `test:e2e` locally (CLAUDE.md Testing section: it dispatches real workers into sandbox repos and is CI's gate, not a local one).

### Bookkeeping

Open the PR through the controller once the branch has its first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — it has no way to find the plan or slice heading and takes its title from the last commit subject instead. `plot-open-pr.sh` reads which plan names the branch and opens the PR with the slice heading ("The spike dispatches") as the title, the plan and this brief in the body.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-12-the-fleet-writes-the-design.md:127`). No project board is configured in this repository's `## Plot Config`, so skip the board-status step.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:
- `packages/domain/src/rules/auto-dispatch.ts` — the five phase-filter sites at lines 531, 582, 617, 656, 733, 798 (line numbers as of this writing; widen each, with `:733` requiring the extra eligible-slice condition)
- `packages/domain/test/auto-dispatch.test.ts` — the new Design-plan/spike test cases
- `packages/fleet/src/shared/auto-dispatch.ts` — the two `hasEligible` reads at lines 243 and 282
- `packages/fleet/test/unit/auto-dispatch.test.ts` — the briefless-spike-reaches-`missingBriefs` case

Do not touch `packages/domain/src/rules/eligible.ts` (`sliceVerdict`/`spikeAdmitted` already merged and correct) or any file under `packages/board/`.

Other branches of this plan, read from the plan's `## Slices` section (not re-verified at dispatch time — confirm with `/plot-pulse` before starting if timing matters): `feature/the-fleet-reads-design-work`, `feature/the-fleet-commissions-the-spec`, `feature/commission-design-is-removed`, `feature/the-board-shows-the-spec-run`. None of them name `auto-dispatch.ts`'s phase filters or the `hasEligible` reads this slice owns — the closest is `feature/the-fleet-commissions-the-spec`, which adds `running` accounting to `assign.ts:229` and a refusal in `verifyStart`, a different file and a different rule. No expected overlap.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
