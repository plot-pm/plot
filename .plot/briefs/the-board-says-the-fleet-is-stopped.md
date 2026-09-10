## Implementation brief — the-supervisor-is-loaded-or-it-is-reported (wave 2: Reporting)

- **Plan (canonical):** `docs/plans/2026-09-09-the-supervisor-is-loaded-or-it-is-reported.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #864 merged
- **Branch:** `bug/the-board-says-the-fleet-is-stopped` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention; Definition of Done gated in CI

This slice waits on `bug/a-fleet-start-records-that-it-finished`, which **merged as #869** and defined the three shell-side states. The next wave, `feature/the-working-header-separates-doing-from-reading`, waits on this one for the state its header renders — so the words and the prominence level this slice settles are what that slice lays out. Do not do its layout work here.

### What to build

**A person read the correct sentence for an hour and did not act on it.** Measured 2026-09-09: the supervisor was unloaded, three agents sat idle 44–57 minutes with merged PRs, an eligible slice went untaken, and the board carried the right words — in a grey chip appended to the end of a stepper's status line, reading `· unsupervised`.

So this is **not a new rule**. `supervisorVerdict` (`packages/domain/src/rules/supervisor-reading.ts:188`) already answers three states, already keeps *down* apart from *could not ask*, and already prints the repair `/plot-fleet --start`. What is wrong is two things and only two:

1. **The vocabulary.** The badge says `unsupervised` and `supervisor unknown`. Neither word is one a user can act on — there is no `/plot-supervisor` command, no skill by that name, nothing addressable. The user types `/plot-fleet`.
2. **The weight.** A stopped fleet is work not happening, and it renders as a status chip an operator scans past.

Change the words to FLEET, add the prominence level that earns the top of the section, and leave the state machine alone. The plan's Design section is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The word is FLEET, and the estate already taught it.** `/plot-fleet --start`, `/plot-fleet --status`, `/plot-fleet --stop` — three commands a person types. `plot-registryd.mjs`, the launchd label `com.plot-pm.registryd` and the verdict `supervised` describe one process in three internal vocabularies, and **the board is the one surface where a reader should meet none of them.** The internal words stay internal and stay correct: `plot-fleetctl.sh` and `DESIGN-process.md` are machine-side, where *supervisor* names a role precisely. Do not rename those. `CLAUDE.md` already splits Machine-side vocabulary from Registry-side "by the component doing the observing"; a board reader is neither.

**`unknown` stays quiet, and that asymmetry is the point.** *I could not ask* is a reading about the board, not about the fleet. Alerting on it trains an operator to dismiss the alert that matters — which is the failure mode this whole plan exists to remove. Only *asked, and it is not there* is loud. The three target readings:

| verdict today | what a person needs | prominence |
|---|---|---|
| `supervised` (silent) | Fleet running — stays silent | quiet, `shown: false` |
| `supervisor unknown` | Fleet status unknown — I could not ask | quiet chip, as now |
| `unsupervised` | **FLEET STOPPED** — and loud | prominent |

**It names the consequence, not the condition.** *"Fleet stopped — no slice will be picked up"* is what a reader decides about. *"supervisor unknown"* names a component and leaves the consequence to be derived. The existing `detail` sentence already does this correctly — *"Nothing reaps a finished desk or marks a spent one. Start it: `/plot-fleet --start`"* — so it is the `label` that needs the work, not the detail.

**`prominence` already exists as a field, so the mechanism is there.** `SupervisorProminence = 'quiet' | 'note' | 'warn'` (`supervisor-reading.ts:96`). What the plan adds is *the state that earns the top of the section*. Whether that is a fourth member or a reuse of `warn` plus a placement decision is yours — but it is a **domain property either way**, per `CLAUDE.md`'s *every rendered state is a domain property*: a `.tsx` that decides its own placement from `state === 'down'` is the decision-in-a-component the layering rule forbids, and `FleetControls.tsx:284` already says so in a comment about itself.

**`ChecksProminence` is a separate enum with identical members** (`rules/checks-reading.ts:54`). It has its own five states and its own tests. Widening `SupervisorProminence` does not touch it, and "unifying" the two is out of scope.

**The board reports and does not act.** Starting a supervisor from a rendering path makes a page load a lifecycle action, which is the boundary `DESIGN-process.md` draws: fleet control and the board are independent systems sharing a machine, and neither may become a dependency of the other. The alert carries the repair as **text a person runs**, never a button that runs it.

**The reading is already taken and already split by clock.** `fleet.ts:7009` applies `supervisorVerdict` on the render clock while `fleet.ts:2706` takes the script reading on the refresh clock — deliberately, so a warning is a current agent count against the last known state. Do not fold them; `supervisor-reading.ts:77` states the reason.

**Rules carried over unchanged.** `unknown` is not a spelling of `down` — a board that could not ask must render neither an alarm nor an all-clear. The exit code is the contract and the summary line proves it was the script's; a timed-out `execFile` reports code 1, which is indistinguishable from a real *not loaded*, so silence must never become `down`.

### Done when

The plan's `## Done when` — the six **Asserted:** clauses on the `Reporting` slice — is the specification. Lift these in particular, because a naive implementation passes without them:

- **The rendered UI says FLEET and never `supervisor`, `registryd` or `unsupervised`.** Assert on what the browser renders, not on what the domain returns — a label changed in the rule while a component still concatenates its own prefix passes a unit test and fails a reader.
- **The label matches the repair it prints.** A badge naming one component while its fix names another is the inconsistency this removes; assert the pair, not each alone.
- **`unknown` and `stopped` are different words, and only `stopped` is prominent.** One assertion catching a collapse in either direction — the alerting-on-unknown mistake is what would train the dismissal habit back in.
- **The board starts nothing.** In all three states. This is the read-only contract, and it is the assertion a refactor silently breaks.

**The two anti-contract assertions are yours to rewrite, and that is the work.** `packages/board/test/integration/supervisor-badge.browser.test.ts:143` asserts the badge text contains `unsupervised`, and `:191` asserts `supervisor unknown`. Both exist to lock words this slice deliberately replaces. A red test there is the slice landing, not a regression — rewrite them to assert the new words, and make at least one discriminating so a future silent revert fails.

Plus the repo's gates: `nvm use` first (Node 24 — pnpm crashes on 26), `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board` with the rebuilt artifact committed, and a changeset. **Do not run `pnpm run test:e2e`** — it is CI's gate, not a local one. Browser tests load the built artifact, so build before running them or a stale artifact fails reassuringly.

Changeset: `'@plot-pm/board': patch` frontmatter for a `packages/board` change, description FIRST and any `bumps:` block LAST. `.changeset/` holds siblings' files — add your own, touch none.

### Bookkeeping

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh
```

It takes the title from the plan's wave heading and refuses a branch no plan names. **Do not run `gh pr create`** — three slice PRs opened that way on 2026-09-08 each took their title from the last commit subject.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/rules/supervisor-reading.ts` — the labels, and the prominence level
- `packages/domain/test/supervisor-reading.test.ts` — its unit assertions
- `packages/board/src/contract/schema.ts` — `SupervisorSchema`, only if the prominence enum gains a member
- `packages/board/src/app/components/FleetControls.tsx` — the badge's rendering
- `packages/board/test/integration/supervisor-badge.browser.test.ts` — the two locked words

**Not yours:** the WORKING header's layout, the right-aligned control column, the manifest-count collapse, and the synthesized-row-becomes-an-error change. All four belong to `feature/the-working-header-separates-doing-from-reading`, which waits on this branch. The badge currently renders **inside** `ParallelAgentsStepper` (`FleetControls.tsx:301`) — that coupling is real and it is the next slice's to unpick. Change the words and the prominence where they are.

Also not yours: `plot-fleetctl.sh`, `DESIGN-process.md`, `plot-registryd.mjs` and the launchd label. Those are machine-side and *supervisor* is the correct word there.

No other branch in this plan is in flight — `bug/a-fleet-start-records-that-it-finished` merged as #869, and the Reading slice has not started.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
