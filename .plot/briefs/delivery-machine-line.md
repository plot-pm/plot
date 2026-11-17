## Implementation brief — delivery-machine-tickets-footer (wave 2: Machine line)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-machine-tickets-footer.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-machine-line` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the second slice of plan 6 of 6 of the Delivery tab design. It waits on `feature/delivery-tickets-section` (PR #3492): start only once that slice has merged. `feature/delivery-tab-footer` waits on this slice, and both slices rework the bottom block of `AgentList.tsx`, so the heading order is a real conflict order and not a preference.

### What to build

The Machine section prints one string, built by `machineLine(rows, answer)` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:478`) and rendered at `AgentList.tsx:1458`. With no process running and the host answered, it reads "none — nothing — a machine is working". Measured on the running board on 2026-11-16: that text contradicts itself, and the section says nothing about the machine's health, its load or the host budget.

This slice replaces the string with a Machine health line. A healthy machine shows one header line and no body: "● healthy · load 2.1 of 10 cores · GitHub 4,210 / 5,000 left". A strained machine turns the dot amber or red and lists only the resources that limit the fleet, as Resource · Now · Effect ("GitHub GraphQL · 0 / 5,000, resets 16:42 · PR reads use REST"). An unmeasured machine shows a grey dot and "not measured".

Build on what exists. `Machine` (`packages/domain/src/entities/machine.ts`) already carries `headroom`, `loadAverage` and `cores`. `machineSystem(context).measure` (`packages/domain/src/adapters/machine/machine-system.ts`) takes the reading; fleetd calls it in `fleetCapForRepo` (`packages/fleet/src/server/entry/registryd-main.ts:1597-1603`). The connector's `LimitReading` (`packages/domain/src/entities/limit.ts:59`) holds the remaining host budget. The board payload (`packages/board/src/contract/schema.ts`) carries none of these figures, so this slice adds `headroom`, the 1-minute load, `cores` and the host budget to the fleet payload. The board server fills them in `packages/board/src/server/fleet.ts`, which already serves `prAgeSeconds` and `prIntervalMs` from the same entry (`fleet.ts:8700-8704`).

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The dot is `Headroom`, and load is never the verdict.** `clear` is green "healthy", `tight` amber "tight", `starved` red "starved", `unmeasured` grey "not measured". `headroomFor` documents why: five workers ran fine at load 10 on one occasion and starved the machine at load 8 on another. A naive implementation colours the dot from load against cores and passes a test with a calm machine. Assert a high-load `clear` machine (green) and a low-load `starved` machine (red).

**`unmeasured` shows the one-line form and no body.** A null `spawnCostMs` defers nothing (`dispatchDefers`, `machine.ts:115`), so it is not a strained state. Its line differs from `clear` in dot and word only. A naive implementation renders `unmeasured` as `clear`, and a null cost then reads as healthy.

**The line shows the 1-minute load.** `loadAverage` holds three values; the first is the one shown.

**The board measures at most once per 60 s per board process and serves the last reading to every `/api/fleet` poll.** The poll runs every 4 s, and each measurement forks a process, so measuring per poll puts the cost on the machine the line describes. Assert it with a fake clock: two polls inside 60 s call `measure` once, a poll after 60 s calls it again. A failed measurement reads `unmeasured` and does not stop the next attempt.

**The host's name comes from the connector's backend word.** The line never hard-codes "GitHub". Assert it with a second connector name. The remaining budget comes from the connector's `LimitReading`, which the connector already records; add no host call.

**No CI-queue figure exists, and the line shows none.** The design forbids a new host read (*Non-goals*). The plan names this as a gap. Do not invent a reading, and do not leave a placeholder for it.

**The `HostAnswer` states stay on the one-line form.** `unasked` shows the host figure as not yet asked, and `unreachable` shows it as an outage. The rulings of 2026-11-10 in `docs/plans/2026-11-08-every-work-item-and-agent-shows.md` stand: a board that has not asked the host prints no `none`, and a failed first call reads as an outage. An absent budget is not `0 left`. `HOST_ANSWER_HINT` and `hostAnswer` (`host-notes.ts:218-246`) are the existing source for both words.

**A strained body lists only the limiting resources.** A resource that does not limit the fleet gets no row. Each row carries its effect. The list is a domain property: derive it where `delivery-view.ts` and `host-notes.ts` derive their facts, and write each function as an arrow.

**Every dot carries its state as text.** The word sits beside the dot and is also its accessible name, so colour is never the only signal.

**The text "none — nothing — a machine is working" leaves every state.** Remove the string at `delivery-view.ts:481` and its assertions: `test/unit/delivery-view.test.ts:58`, and the `nothing — a machine is working` expectations in `test/unit/agent-list.test.ts` and `test/integration/agents-tab.browser.test.ts:3880`. Re-point each at the new line. The process count that string carried ("N processes running") belongs to Fleet, not to this line; check where else the count renders before you drop it.

### Done when

The plan's Done When item for this slice is the specification: a healthy machine renders one line and no body, with its dot and word from `Headroom`; an unmeasured machine renders a grey dot and "not measured"; a strained one lists only its limiting resources, each with an effect; the line shows the 1-minute load; `unasked` and `unreachable` host answers show as not asked and as an outage; the host's name comes from the connector; the board measures the machine at most once per 60 s; no Delivery text reads "none — nothing — a machine is working". Each is asserted in a unit test, and the absent text also in a browser test.

Lift these assertions, because a naive implementation passes without them:

- A unit test on the Machine fact asserts that no state yields "none — nothing — a machine is working". This catches the old string surviving in one `HostAnswer` arm.
- A high-load `clear` machine is green and a low-load `starved` machine is red. This catches a dot derived from load.
- A null `spawnCostMs` gives grey "not measured", not green "healthy".
- A healthy machine gives a line and no body; a `tight` or `starved` one gives the body with only its limiting resources.
- Two payload reads inside 60 s call `measure` once. This catches a measurement per poll.
- A connector named other than `github` shows its own name.
- `unasked` and `unreachable` show their words and no `0 left`.
- One browser test proves the Machine section shows the one line and that the removed text is absent from the page.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. The payload gains fields, so run `pnpm run typecheck` and the domain typecheck that `plot-local-checks.mjs` prints. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Look at the rendered line at 320 px and in both themes. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-machine-tickets-footer.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. If you find you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Machine section: `machineLine` and its caller at `AgentList.tsx:1458`, the new Machine health fact beside `delivery-view.ts` and `host-notes.ts`, the fleet payload fields in `packages/board/src/contract/schema.ts` and their fill in `packages/board/src/server/fleet.ts`, and the unit and browser tests of those. It reads `packages/domain/src/entities/machine.ts`, `limit.ts` and `adapters/machine/machine-system.ts` and changes none of them: `Machine` already carries the figures, and the plan says to add them to the payload, not to the domain.

Other branches in flight: `feature/delivery-tickets-section` owns the Tickets section and the "Tickets and plan runs" block in `AgentList.tsx`; `feature/delivery-tab-footer` owns the footer at `AgentList.tsx:1577-1620` and `view.notPlaced`. Keep clear of both blocks. If you find something the plan did not anticipate, report it rather than improvising outside scope.
