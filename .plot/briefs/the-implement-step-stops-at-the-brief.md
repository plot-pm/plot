## Implementation brief — a-start-step-leaves-no-claim-and-no-desk (wave 1: The implement step stops at the brief)

- **Plan (canonical):** `docs/plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md` on main
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-implement-step-stops-at-the-brief` (base: `main`)
- **Ends as:** one PR to main, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** repo convention (CI green + review)
- **Issues:** #1090, #1151

The plan has two waves, and they are independent: the plan says so in `## Slices`. Wave 2, `bug/a-worker-less-checkout-yields-its-branch`, clears a leftover checkout in `reset_desk`. This branch stops the dispatch path from making new ones. Neither waits on the other.

### What to build

Every board dispatch runs `/plot-implement` before `plot-dispatch.sh` (`packages/board/src/server/dispatch.ts:356-372`). The skill's step 3 then pushes a claim ref and cuts a worktree, and stops. Nobody works that claim: `claimedBranches` (`registryd-main.ts:554-562`) reads the ref as claimed, `queueOfPlan` drops the slice, and the supervisor never hands it out. Measured 2026-10-01: three slices of `the-fleet-runs-through-its-limits` sat at `142ae697` with no worker until a person released their refs. When one was then handed to agent `11945014`, the leftover checkout at `.worktrees/the-merge-subject-is-one-rule` held the branch and `git checkout` refused it (#1151).

The fix has two parts:

1. **`/plot-implement --brief-only`.** In `skills/plot-implement/SKILL.md`, the flag runs step 1 (locate), step 2 (preflight), step 4 (brief) and step 5 (`Started:`), and skips step 3 completely: no checkout, no `git push -u`, no worktree, no `plot-fleet-scan.sh --next`. Step 6's summary says that the supervisor hands the slice to a free agent.
2. **`composeImplementPrompt` asks for it.** `packages/board/src/server/implement.ts:122-124` returns `Run /plot-implement ${slug} --brief-only and follow it.` Both callers, `/api/dispatch` and `/api/implement`, go through this one function (`:225`), so one edit covers both.

The plan is canonical. This brief is orientation.

### Decisions the plan settles

**The claim belongs to the agent, not to the implement step.** The loop already claims at take-up: `plot-worker-loop.sh:2269-2270` commits `plot: claim <branch>` and pushes it. A ref that already exists rejects that push, and the loop then logs `REGISTRY LOCK VIOLATION` (`:2291`) and asks for another branch. So a claim the implement step pushed first does more than idle: it makes the handed agent read its own slice as double-assigned. Do not keep the claim and "teach the supervisor to adopt it". The plan rejects that because `claimedBranches` reads every remote branch as claimed and cannot tell a dispatch claim from a person's claim (`What this does NOT do`, bullet 2).

**The `Started:` record stays.** `decidePlanStatus` reads `started: meta.started_raw.length > 0` (`packages/board/src/server/board.ts:1004`) to derive *Ready* against *In progress*. A plan whose brief is written is in progress. Do not drop step 5 in `--brief-only` mode.

**A flag, not a new default.** `/plot-implement` run by a person without the flag keeps step 3. A person who claims a branch is about to work it, and that claim is legitimate. Add one sentence to step 3: the claim belongs to the session that pushed it, and a supervisor never works it. Do not remove step 3 or move it to another skill.

**The prompt stays a sentence.** `composeImplementPrompt`'s TSDoc explains that the runner is a `claude -p` agent and the slug travels as one argument, never spliced into the command string. Append the flag inside the prompt text. Do not add it as a second argv entry to the `sh -c` call at `:225`.

**Invariants carried over unchanged:**

- Every question in a skill declares its unattended shape (`test/reconcile/unattended.test.mjs` sweeps all skills). The two existing `PLOT-UNASKED` lines say *"no branch created"*. That stays true in `--brief-only` mode, but check that every unattended line you touch or add still has a `PLOT-UNASKED:` form.
- When you change steps, update the `## Model Guidance` table. Row 3 must say that `--brief-only` skips it.
- `README.md` beside `SKILL.md` is required and describes the flag too.

### Capability reason

The plan's Open Point: an operator may read *Implement* as "cut me a desk". This plan does not relabel the button. It states the new effect where the board already names it:

- `implementAvailability` (`implement.ts:104-106`) passes `'preparing a plan for implementation'` to `localCapability`. That phrase still holds. Leave it unless your reading of `localCapability` (`controllers/caller.ts:56`) shows it reaches the operator as the effect.
- `ImplementButton.tsx:193` titles the enabled button `Implement ${slug} — prepare a slice with /plot-implement`, and the component's TSDoc (`:9-12`) lists *"the branch, the hand-off brief"*. Both describe the old effect. Change the title to name what the click now does: the brief and the `Started:` record, no branch. Correct the TSDoc list and the timeout comment at `:40` that names *"branch"*.

Keep this to wording. The button's label and its placement are out of scope.

### Done when

The plan's `## Done when` is the specification. For this branch:

- **`composeImplementPrompt('x')` contains `--brief-only`.** Add it to `packages/board/test/unit/implement-route.test.ts:126-133` (`carries the slug into a /plot-implement instruction`). This catches a skill change that ships while the board still sends the old prompt, which re-creates the defect on every dispatch.
- **The dispatch test asserts the flag reaches the stub.** The plan cites `packages/board/test/dispatch.test.mjs:448`; on main that line is in the `implement-started` 202 key-set test and reads no prompt. The assertion belongs at `:109`, in `calls the implement stub first, then plot-dispatch.sh`, which already matches `stub.implementRuns()[0]` against `/plot-implement.*ship-the-widget/`. Extend that match to require `--brief-only`. This catches a second caller that builds its own prompt rather than calling `composeImplementPrompt`.
- **One run on this repository after the merge** shows no remote ref and no worktree for a dispatched slice. That check is the operator's, after delivery. Do not run a real dispatch from this branch.

Plus the repo gates: `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck`. `pnpm run test:board` rebuilds `skills/plot/scripts/board/board-server.mjs`; commit the rebuilt artifact. Do not run `pnpm run test:e2e`: it is CI's gate.

**Changeset:** one file, package `plot` for the skill and `@plot-pm/board` for the server change, with a `plot-implement: minor` bump. Description first, `bumps:` block last, `plan:` line inside the block:

```markdown
---
'plot': minor
'@plot-pm/board': patch
---

The implement step a dispatch runs writes the brief and the `Started:` record and stops. It pushes no claim and cuts no checkout, so the supervisor hands the slice to a free agent.

<!--
plan: docs/plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md
bumps:
  skills:
    plot-implement: minor
-->
```

Run `./scripts/check-changeset-packages.sh` before you push. Do not edit `metadata.version` by hand.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (or `--draft`). Do not run `gh pr create`: it titles the PR from the last commit subject.
- When the PR exists, append `→ #<number>` inside this branch's heading in the plan's `## Slices` section, in the form `(Branch: bug/the-implement-step-stops-at-the-brief, PR: #<number>)`. Make that edit on `main` from a detached scratch worktree, not on this branch.

### Scope guard

This branch owns:

- `skills/plot-implement/SKILL.md` and `skills/plot-implement/README.md`
- `packages/board/src/server/implement.ts` (`composeImplementPrompt` and its TSDoc)
- `packages/board/src/app/components/ImplementButton.tsx` (title and TSDoc wording only)
- `packages/board/test/unit/implement-route.test.ts` and `packages/board/test/dispatch.test.mjs`
- the rebuilt `skills/plot/scripts/board/board-server.mjs`
- one `.changeset/*.md`

Verified at brief time (2026-10-02, `origin/main` at `b4f6a491`): no remote branch changes any of these files, and no remote ref exists yet for either branch of this plan.

Branches in flight that sit close:

- `bug/a-worker-less-checkout-yields-its-branch` (wave 2 of this plan) owns `plot-worker-loop.sh`, `packages/domain/src/rules/checkout-yield.ts` and a new bundle. Do not touch `reset_desk`.
- `a-landed-brief-frees-its-slot` (Draft, #1162) plans changes to `packages/board/src/server/auto-dispatch.ts`. Do not touch auto-dispatch's brief budget.

Out of scope, as the plan states: `claimedBranches` and the queue, `plot-dispatch.sh --release` (#1152), and the board half of #1090 that shipped in v2.22.0.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
