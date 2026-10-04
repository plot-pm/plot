# Round 2 — Moderation

**Subject:** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` at `c390671e6`
**Lenses:** estate, contradiction, deliverable, cost
**Gate:** each verdict checked with `plot-panel.mjs check Position "proceed,amend,reject" <lens>`; all four exit 0
**Reconcile:** `unanimous	amend	estate,contradiction,deliverable,cost`

## Round-1 findings

| Lens | Answered | Partly answered |
|---|---|---|
| estate | 7 of 9 | 2: the `DeskState` column, the removal callers |
| contradiction | 10 of 10 | none (the vocabulary fix has a wrong column, now a new finding) |
| deliverable | 7 of 7 | none |
| cost | 6 of 8 | 2: the e2e files and the window length, the slice-6 baseline |

## New findings, by subject

**1. The table's columns do not hold against the rules they cite (estate 1, 2, 8; contradiction 2, 3).**
- `DeskState` has no `blocked`. A desk with a marker reads `refused-with-work` or `refused-empty`, and `refused-empty` reaps the desk.
- `agentState` derives exit 0 from the desk (`taskState`), a non-zero exit with no PR as `failed`, and `ended` only from a stale pid or a missing exit file. The `ended` entries are wrong.
- The table has no row for `unstarted`, and none for the idle watch (`quiet`, `unreadable`). The idle watch is Manifesto principle 13.
- The `checks pass` row reads `DeskState` none only after `desk-reset` removes the claim.

**2. The ending reasons already exist, and a domain rule refuses the new ones (contradiction 1, deliverable 2).** `EndingReasonSchema` (`entities/ending.ts:76-83`) is a closed enum pinned by `ending.test.ts:45`. The plan renames `unregistered` to `deregistered`. `endingIsAttributable` (`transitions/agent.ts:401-415`) refuses an `agent`-actor ending unless the reason is `unstarted`, `limited` or `unregistered`.

**3. Slice 1 cites the wrong rule, gives no offset, and changes #1199 without saying so (deliverable 3, estate 7, contradiction 4).**
- `checkoutYield` is written for another worktree. For the loop's own desk the rule is `resetRefusals`, which the shell pairs as `desk_reset_refusal` (`plot-worker-loop.sh:738`).
- The slice names no lines to remove.
- The descent check is an ancestry call with no `plot-ancestry:` declaration. Design's CI wait dropped the descent condition, so a force-push could settle the wait on someone else's build.

**4. The transition window has two writers and a broken shell path (deliverable 1, 5; cost 4; estate 4).**
- Slice 2 changes `checksVerdict`'s input while the shell loop still calls it through `plot-checks-verdict.mjs`.
- In `js` mode, `plot-dispatch.sh:1491` still starts the BuildMonitor, so two processes write one findings file.
- `plot-dispatch.sh:1485` starts the agent monitor, so the plan's "no orphans" claim is too wide.

**5. The restart is still unsafe (cost 1, 2, 3).**
- Adopters run the bundles on Node 20. `process.execve` does not exist there, and slice 4's `shell` path `exec`s through Node.
- Nothing fast-forwards the main checkout, so "only moves forward" is false.
- All idle loops restart in the same pass, so a broken bundle kills them together and spends supervisor relaunch attempts.

**6. Slice 6 has no `shell` side (deliverable 4, cost 5).** `Worker loop` is one key per repository, so the window after slice 4 holds no `shell` slices.

**7. Counts and citations (estate 5, 6; deliverable 6, 7, 8; cost 6, 7).**
- The removal list misses callers: of `plot_worker_idle_now` (the `sample` corpus, two test files) and of the build monitor (`package.json`, `.gitignore`, `entities/finding.ts`, `manifest-stamp.ts`, `registry.ts`).
- The "bundle-resolution preamble" does not exist.
- `attention.ts:167` does not read the findings file.
- "22 driving" and "8 BuildMonitor files" have no reproducible command.
- The `js` CI leg does not say whether it includes e2e.
- macOS has no CI runner.

**Disagreements:** none on position. Estate and contradiction found the `DeskState` and `AgentState` columns wrong from different rules (`desk-lifecycle.ts` and `agent-state.ts`). Deliverable and contradiction found the ending-reason conflict independently.

## What the four lenses had in common

All four checked the amendment against the code that it cites, and that found most of round 2's findings. Each round-2 finding is a wrong reading of a named rule, not a wrong direction. None of the jurors questioned the slice count. The plan has grown from 4 slices to 7, and the transition window (slices 4 to 6) is where most round-2 findings sit. A plan with fewer coexisting modes would have fewer of those findings. The amendment shortens the window where it can.

## Outcome

Amend. The amended plan answers every finding above. Each answer is recorded in the plan.
