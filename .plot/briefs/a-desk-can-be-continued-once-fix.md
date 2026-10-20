## Implementation brief — a-desk-can-be-continued-once (wave: Fix)

- **Plan (canonical):** [docs/plans/2026-10-19-a-desk-can-be-continued-once.md](../../docs/plans/2026-10-19-a-desk-can-be-continued-once.md) on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2114 merged
- **Branch:** `bug/a-desk-can-be-continued-once-fix` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan's `Review: pr`)

This branch waits on `bug/a-desk-can-be-continued-once-test`, which merged as PR #2122 — nothing blocks starting.

### What to build

`continueTarget` (`packages/domain/src/rules/continue-target.ts:153-155`) refuses `no-manifest` for three of the five `NEEDS_PERSON_ENDINGS` reasons — `spend-limit`, `run-limit`, `checks-unanswered` — because its fallback only accepts `blocked`, `holding-work` and `unstarted`. A desk whose continued run ends with any of those three refused reasons cannot be continued again: that's the real incident (`free-fcd71bc3` on `bug/a-click-on-a-plan-story`, PR #2104, refused at 15:10 UTC; `free-7edb8d31` hit the same refusal earlier the same day).

Widen the fallback at `continue-target.ts:153-155` to accept every reason in `NEEDS_PERSON_ENDINGS` (`packages/domain/src/rules/ending-action.ts:213-219`), derived rather than copied — use `endingAsksPersonOutright(ending.ending.reason)` (same file, line 229) in place of the three-way `||`, so a sixth ending added to that set is picked up automatically and this rule cannot drift from it again.

### The decision the plan settles — do not re-derive it

**This is Approach A, not B, and it is already chosen — not a judgment call for this slice.** The plan's Open Points asked "A or B?" and "which ending did the two affected desks record?" and "should spend-limit/run-limit continue at all?". All three are answered by the merged reproduction test (`packages/board/test/unit/continue-route.test.ts`, describe block `'a desk continued twice, once per NEEDS_PERSON_ENDINGS reason — #2107'`, added in PR #2122):

- The three `it.fails` rows (`spend-limit`, `run-limit`, `checks-unanswered`) are the measured scope of the bug, and the test file's own comment above them says explicitly: *"wave 2, `bug/a-desk-can-be-continued-once-fix`, flips these to plain `it` once the fix ... makes them pass"* — naming `continue-target.ts:122-125` (now 153-155) as the fix site.
- Writing `it.fails` rather than `it.skip` for `spend-limit` and `run-limit` is the answer to Open Point 3: yes, they should continue. A skipped row would have measured nothing; a failing one commits to the outcome.
- B (leave a manifest on stop, touching `worker-loop.ts`) was rejected in favor of A specifically because A is "the smaller change and stays in the domain rule" — do not touch `worker-loop.ts` or the stop path for this slice.

**Do not re-decide any of this.** The job is: flip the fallback condition, then flip the three `it.fails` to plain `it`.

### Guard cases that must keep refusing — unchanged by this fix

The same test file's `describe('guard cases that must keep refusing after the fix', ...)` block asserts two things stay `no-manifest` after the widen:

- An **absent** ending record (`ending.read !== 'ended'`) — absent is not a fallback, per the rule's own doc comment. `endingAsksPersonOutright` only ever receives a `reason`, so this guard is enforced by the existing `ending.read === 'ended'` check staying in place, not by the widened condition itself.
- An ending naming a **different branch** — the `ending.ending.branch === reading.branch` check must stay exactly where it is.

Widening the accepted *reasons* must not widen what counts as *evidence*. If either guard test starts passing for the wrong reason (e.g. because the branch check got dropped), that's a regression this slice introduces, not a pre-existing pass.

### Done when

The plan's `## Done when` list doesn't exist as a separate section here (this plan embeds it in Slices); the operative spec is:

- `continue-target.ts`'s fallback accepts all five `NEEDS_PERSON_ENDINGS` reasons for a matching branch, derived from `endingAsksPersonOutright` rather than a hand-copied list.
- The three `it.fails` rows in `continue-route.test.ts` (`spend-limit`, `run-limit`, `checks-unanswered`) become plain `it` and pass.
- The two guard-case tests (absent ending, wrong-branch ending) still pass unchanged — they prove the widen didn't also loosen the evidence requirement.
- `continueTarget`'s own unit tests in `packages/domain/test/continue-target.test.ts` still pass unchanged — none of them assert the old three-reason list by name, so none should need edits, but verify rather than assume.
- Update the doc comment at `continue-target.ts:122-125` (the "4. The fallback" paragraph) to say "any `NEEDS_PERSON_ENDINGS` reason" rather than naming three by name, so the comment doesn't re-fossilize the old scope.

Plus the repo's gates: no changeset is needed for `packages/domain/src/rules/` changes beyond what `check-changeset-packages.sh` requires if you touch `package.json` (you won't). Run the local checks before each push:

```
node skills/plot/scripts/board/plot-local-checks.mjs
```

from the repo root, and run what it prints — it resolves to the tests naming your changed files, the related `@plot-pm/domain` vitest run, and `tsc --noEmit` for the domain package, plus the gate scripts under `scripts/check-*.sh`. The suites under `CI suites` in `## Plot Config` run in CI on the PR; don't run them locally.

Name the shell gate too: `scripts/check-shell-lines.sh` ratchets the shipped shell's total line count against the merge base. This slice touches no `.sh` file, so it shouldn't trip — but if an edit does touch one, growth must be paid for by removing an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once there's a real commit:

```
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not use `gh pr create`. Push the first real commit as soon as it exists — don't wait for the whole slice to be done before the branch has anything to show.

When the PR is created, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Fix` heading.

### Scope guard

This branch owns:

- `packages/domain/src/rules/continue-target.ts` (the fallback condition and its doc comment)
- `packages/board/test/unit/continue-route.test.ts` (flipping the three `it.fails` rows)

Nothing else in the plan's territory is in flight concurrently: the only sibling branch, `bug/a-desk-can-be-continued-once-test`, already merged as PR #2122 and is the reproduction this slice depends on — there is no live sibling to collide with.

If you find the widen requires touching `worker-loop.ts` or anything outside `continue-target.ts` and its own test, that means Approach A doesn't hold after all — stop and report rather than sliding into Approach B's territory unreviewed.
