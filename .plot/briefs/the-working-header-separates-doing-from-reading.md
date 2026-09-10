## Implementation brief — the-supervisor-is-loaded-or-it-is-reported (wave 3: Reading)

- **Plan (canonical):** `docs/plans/2026-09-09-the-supervisor-is-loaded-or-it-is-reported.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #864 merged
- **Branch:** `feature/the-working-header-separates-doing-from-reading` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; Definition of Done at `docs/definition-of-done.md`

This is the last of three waves and it waits on nothing further. Both predecessors are merged: `bug/a-fleet-start-records-that-it-finished` (#869, 2026-09-10 00:28) and `bug/the-board-says-the-fleet-is-stopped` (#873, 2026-09-10 09:33). Nothing waits on this slice; delivering the plan follows it.

### What to build

The WORKING and NOT STARTED section headers separate what a person **does** from what a person **reads**. Today one line carries a control, its label, three counts and an alert in reading order with no boundary:

```
🤖 WORKING (3)  − 4 +  parallel agents (cap) · 3 working · 3 manifests, 2 synthesized · supervisor unknown
```

The concrete failure is positional. The stepper sits inline after a tally whose width changes with the data, so the control moves between renders and is a target the operator re-finds every time. Right-aligned in its own column it lands in the same place on every section that has one.

Target shape, both sections sharing one control column:

```
📋 NOT STARTED (3 plans · 5 slices)              auto-dispatch ☑
🤖 WORKING (3) · 3 running                    parallel agents − 4 +
   ⚠ FLEET STOPPED — nothing is being supervised. /plot-fleet --start
```

Four changes: the two controls move to a right-aligned column; the supervisor alert leaves the stepper for its own line under the header; the counts collapse to what a person can act on; a desk with no manifest renders as an error row rather than a synthesized one. The plan is canonical — this is orientation.

### The decisions the plan settles — do not re-derive them

**The alert is in the wrong component right now, and moving it is the first task.** The plan describes the alert as a thing that "takes its own line," but wave 2 (#873) shipped it *inside* `ParallelAgentsStepper` — `packages/board/src/app/components/FleetControls.tsx`, the `supervisor?.shown &&` block at the end of the returned `<span role="spinbutton">`. That was correct for wave 2, which had no header layout to hang it on. It is wrong now: the alert is nested inside a `spinbutton`, so a screen reader reads the outage text as part of the control's value, and right-aligning the control would carry the alert into the control column. **Extract it to a sibling of the header before moving anything.** The plan states the rule — "The alert is neither, so it takes its own line. It is not a control and it is louder than a status; competing for either edge would make it one of them."

**Do not choose the alert's words, colours or visibility.** `supervisorVerdict` (`packages/domain/src/rules/supervisor-reading.ts`) already returns `state`, `prominence`, `shown`, `label` and `detail`, and wave 2 already renamed every label to the FLEET vocabulary — `FLEET STOPPED`, `fleet status unknown`, `fleet running`. The component maps `prominence` to classes and renders the strings it is given. A prefix concatenated in the `.tsx` would be a second vocabulary no test of the rule can see. This is the layering rule in `CLAUDE.md`: every rendered state is a domain property.

**`unknown` stays quiet and only `stopped` is loud.** `supervisorProminence` already encodes it: `unknown` → `note` however many agents run, `down` with agents → `alert`, `down` with none → `quiet`. Do not promote `unknown` while making the alert prominent. The asymmetry is deliberate — *I could not ask* is a reading about the board, and alerting on it trains the operator to dismiss the alert that matters.

**The WORKING rows stay when the fleet is stopped, and the SECTION carries the warning.** `fleet.ts:383` — "THE WORKING SECTION IS THE REGISTRY" — reads manifests and worktrees from disk, never from the supervisor, so a stopped fleet does not empty the section. Each row's `running` stays literally true because the pids still exist. Hiding the rows loses real processes an operator may need to stop by hand; marking each row repeats one fact N times. Measured 2026-09-07 and quoted at `fleet.ts:2674`: six spent workers ran 23–25 hours against an 8-hour bound and rendered as six healthy rows.

**A control nested in the fold's `<button>` is invalid markup.** The header's collapse toggle is a real `<button>`, and the existing comment at the call site (`AgentList.tsx` ~line 1080) records this: a button inside a button swallows its own clicks. Both controls already render outside it in the same header flex row. Keep that property when you introduce the right-aligned column — the column is a layout change to the `<h2>`, not a re-parenting of the controls into the toggle.

**The error row is already discriminable; no new field is needed.** `identityWasDeclared` in `packages/domain/src/entities/agent.ts` returns `agent.identity === 'manifest'`, and `AgentIdentitySchema` is `z.enum(['manifest', 'synthesized'])`. Its docstring records "Measured 2026-08-28: 0 manifests against 13 dispatch worktrees, so every agent row this estate renders is synthesized" — **that measurement is stale and the estate has moved.** Measured 2026-09-10 on this checkout: 4 manifests in `.plot/agents/` against 11 worktrees. So the discriminator now discriminates, and enforcing it does not turn every row into an error. Had the old measurement still held, this assertion would have made the whole board an error state; check the live split before assuming either way.

**Enforcement changes the row's kind, never its existence.** The desk is what holds the work, so a desk with no manifest must still render — as an error row that names the problem, where the synthesized row quietly papered over it. The plan states the trade explicitly and accepts the loss: deleting a manifest by hand currently leaves an `unknown` row and will now leave an error row.

**`3 manifests, 3 agents` says nothing and is not printed.** The registry annotation in `FleetControls.tsx` already follows this shape — it renders only when `manifestCount === 0 || synthesizedCount > 0`. Reuse that rule for the collapsed counts rather than inventing a second visibility condition; the comment there records why (`0 manifests, 12 synthesized` said in one line what took ten minutes to diagnose).

**The board reports and starts nothing.** The detail carries `/plot-fleet --start` as text a person types. A button there would make a page load a lifecycle action, which is the boundary `DESIGN-process.md` draws — fleet control and the board are independent systems sharing a machine, and neither may become a dependency of the other.

### Done when

The plan's `## Done when` list — the five **Asserted:** clauses under the `Reading` slice — is the specification. Three of them exist because a naive implementation passes without them:

- **The controls render right-aligned in the same column on both sections.** A test that only asserts the control exists passes today. Assert *geometry* — the control's box against the header's right edge, or against the other section's control — not the presence of a class name. This repo has been bitten by string-matched layout assertions before; two sections agreeing is the property, and it is what a later hand right-aligning only WORKING would break.
- **The WORKING rows still render with the fleet stopped.** The naive implementation of "the section carries the warning" is to replace the section's contents with the warning. Assert row count is unchanged between a supervised and an unsupervised fixture.
- **A desk with no manifest renders as an ERROR row and still renders.** Two assertions, not one — the kind changed *and* the row is present. A test asserting only the error kind passes an implementation that drops the desk, which is the outcome the plan explicitly refuses.

**One existing test asserts the containment you must break.** `packages/board/test/integration/supervisor-badge.browser.test.ts:151` asserts the badge is inside `[data-fleet-parallel-agents]`:

```js
expect(await badge.evaluate((el) => el.closest('[data-fleet-parallel-agents]') !== null)).toBe(true)
```

Rewriting it is correct and intended — this is the anti-contract flip: the test encodes wave 2's placement, and wave 3 moves it. **Invert the assertion rather than deleting it**, so the new placement is locked the way the old one was. Note also that this file stubs its own labels (`label: 'unsupervised'`), so it passes despite wave 2's rename; do not read those strings as the current vocabulary.

Plus the repo's gates:

- `nvm use` first — Node 24, per `.nvmrc`. `pnpm` crashes on Node 26. Use `corepack pnpm` if the homebrew pnpm runs its own node.
- `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`.
- **Browser tests load the built artifact** — run `pnpm build:board` before them, or a stale artifact fails reassuringly.
- A changeset naming this plan, description first and the `bumps:` block last. The package is `@plot-pm/board` with package frontmatter, not a skills `bumps:` block, unless you also touch `skills/`.
- **Do not run `pnpm run test:e2e`.** It is CI's gate; running it locally dispatches real workers and starves the machine.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is moving). **Do not run `gh pr create`** — it takes the title from the last commit subject, which on this estate is routinely `plot: build the board artifact`. The controller uses the plan's wave heading, which is `Reading`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, under `### Reading`.
- On a conflict in `skills/plot/scripts/board/board-server.mjs`: do not read the diff. It is generated output marked `-merge`. Take either side, run `pnpm build:board`, commit the result.

### Scope guard

This branch owns:

- `packages/board/src/app/components/FleetControls.tsx` — the two controls and the alert extraction
- `packages/board/src/app/components/AgentList.tsx` — the `<h2>` header layout and the two call sites (~lines 1094, 1097)
- `packages/board/test/integration/supervisor-badge.browser.test.ts` and `fleet-settings.browser.test.ts` — the placement assertions
- `packages/domain/src/**` only if the error-row kind needs a rule; prefer reusing `identityWasDeclared`

Nothing else in this plan is in flight — waves 1 and 2 are merged and their files are settled. `packages/domain/src/rules/supervisor-reading.ts` is wave 2's and needs no change: it already answers every state this header renders. Touching it is a signal you are re-deciding something the domain settled.

New functions are arrow functions, including in board files and tests — the rule follows the diff, not the file. Do not convert neighbouring declarations you are only passing through.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
