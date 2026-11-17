## Implementation brief — delivery-machine-tickets-footer (wave 3: Footer)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-machine-tickets-footer.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-tab-footer` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the last slice of plan 6 of 6 of the Delivery tab design. It waits on `feature/delivery-tickets-section` (PR #3492) and `feature/delivery-machine-line` (PR #3496). Both have merged, so the slice is eligible. Nothing waits on it inside this plan.

### What to build

The footer is one `<p>` at `AgentList.tsx:1589-1626`. It prints "N branches across M plans", then a chain of string fragments: "scanned Ns ago", "next in Ns", "PR data Ns ago", "next in Ns", "no PR data yet". The desks the board cannot place render as a list above it (`AgentList.tsx:1528-1548`), headed "N subjects not placed —", with absolute desk paths on the page. Measured on the running board on 2026-11-16: "5 subjects not placed" with absolute paths, and "PR data 485s ago" as page content. A reader cannot tell from the seconds whether 485 s is normal, because the age has no reference interval.

This slice replaces both with one footer line, built from a domain fact: how old the board read is and how old the PR data is, each with the time of the next read and a dot; the branch and plan counts; "<n> desks not placed · details", with the desk paths behind **details**. Example: "● fresh · board read 3 s old · next in 2 s · ● aging · PR data 8 min old · next read in 2 min · 8 branches across 3 plans · 5 desks not placed · details".

Build on what exists. The readings are on the payload already: `prAgeSeconds`, `prNextInSeconds` and `prIntervalMs` (`packages/board/src/contract/schema.ts:4596-4620`), `readRefAge` (`schema.ts:4468`) and `scanNextInSeconds`. The client derives `prNext` and `gitNext` at `AgentList.tsx:892-902`. The not-placed list is `view.notPlaced` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:206, 429`). The slice adds no payload field and no host call.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**A dot's state is the age against the reading's own interval.** Green "fresh" while the age is at most one interval, amber "aging" up to three intervals, red "stale" beyond, grey "age unknown" where no interval is known. The PR data's interval is `prIntervalMs`, which `scheduleNextPr` stretches per backend (`schema.ts:4598-4608`), so it is not one constant. The board read's interval is the client's poll interval, 4 s. A naive implementation hard-codes 60 s for the PR data and colours a Bitbucket board, whose cadence is longer, amber on every beat. Assert a reading with `prIntervalMs` 120000 and an age of 100 s as green, and the same age against 60000 as amber.

**No interval means grey, never green.** `prIntervalMs` is null on an older server. Rendering it as fresh would say "I don't know" as "all is well". The same reasoning is in the field's own comment.

**Where `prNextInSeconds` is null, the footer shows the age only.** No fleetd runs then, and a client that assumed a cadence would count to zero and sit there. "PR data 8 min old", with no next-read part. This is the existing rule at `AgentList.tsx:896-902`; carry it into the fact. A naive implementation prints "next read in 0 min" for null.

**The age renders in minutes once it passes 60 s.** The plan's examples read "8 min old" and "next read in 2 min". Seconds under a minute stay in seconds. The unit is part of the fact, so a unit test asserts it and the component does no arithmetic.

**A frozen tab stays frozen.** `tick` stops while the tab is stale, so the age freezes rather than ageing against a scan that is not happening (`AgentList.tsx:1608-1622`, "(frozen)"). The fact takes the ticked age as input and keeps that word. Dropping it makes a dead page look alive.

**The count is of what arrived.** While `fleet.complete` is false the total reads "so far" (`AgentList.tsx:1596-1606`). Keep it: only the total is provisional, and the line must say so.

**The footer is a domain fact, and the line holds no path.** The fact holds its freshness entries (age, next read or none, dot state and word), the branch and plan counts, and the not-placed entry as a count plus a separate `details` list of desk paths. The line renders the count and never a path; the paths render only when **details** is open. A unit test asserts that the line's text holds no path, with a fixture whose paths begin with `/`. Without it, a path leaks into the line in the one arm nobody renders in a test. Write each function as an arrow, per the domain rule, and put the fact beside `delivery-view.ts` and `host-notes.ts`.

**Every dot carries its state as text.** The word sits beside the dot and is also its accessible name, so colour is never the only signal. **details** is a button in the tab order that opens and closes with Enter and Space and carries `aria-expanded`.

**The not-placed list moves behind details; it does not move to Fleet.** Rows with `u.rows.length > 0` (`AgentList.tsx:1541-1548`) keep rendering inside the opened details. The count in the line and the list in the details come from the same `notPlaced` array, so they cannot disagree.

**Rules carried over unchanged.** Absent is not zero: a null age is "no PR data yet" and never "0 s ago" (`AgentList.tsx:1608-1622`). A failed PR read (`fleet.prError`) keeps its existing wording in the status panel (`prStatusEntry`); the footer repeats none of it.

### Done when

The plan's Done When item for this slice is the specification: the footer shows each freshness in minutes with the next read time, or the age only where no next read exists; each dot's state follows the age against its interval, with a word beside it; the desk paths show only behind **details**, a keyboard button; each asserted on the footer fact.

Lift these assertions, because a naive implementation passes without them:

- Two readings with the same age and different `prIntervalMs` give different dot states. This catches a hard-coded cadence.
- A null `prIntervalMs` gives grey "age unknown". This catches null read as fresh.
- A null `prNextInSeconds` gives the age and no next-read part.
- The line's text holds no desk path while `details` holds all of them.
- The not-placed count equals the length of `details`.
- A stale tab keeps "(frozen)", and an incomplete scan keeps "so far".
- One browser test proves the footer line shows no path, that **details** opens the paths by keyboard with `aria-expanded` flipping, and that a dot's word is its accessible name. Update the existing footer expectations in `test/integration/agents-tab.browser.test.ts` and `test/unit/pr-footer-sign-in.test.ts` to the new line; run the first with `pnpm --filter @plot-pm/board exec vitest related --run --project parallel <file>`, not the whole board suite.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm run typecheck` and the domain typecheck that `plot-local-checks.mjs` prints. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Look at the rendered footer at 320 px and in both themes. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-machine-tickets-footer.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. This slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. If you find you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the footer `<p>` and the not-placed block in `AgentList.tsx` (`1528-1548`, `1589-1626`), the new footer fact beside `delivery-view.ts` and `host-notes.ts`, `view.notPlaced`'s consumers, and the unit and browser tests of those. It reads the payload fields in `schema.ts` and `fleet.ts` and changes none of them.

Other branches in flight: `feature/delivery-fleet-plan-runs` (plan 4) edits the "Tickets and plan runs" block in `AgentList.tsx`, and its PR #3499 has merged, so rebase on `main` before you start. Keep clear of the Tickets section and the Machine line, which this plan's two earlier slices own. If you find something the plan did not anticipate, report it rather than improvising outside scope.
