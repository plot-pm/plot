## Implementation brief — approval-hands-the-work-to-agents (wave 2: Switched)

- **Plan (canonical):** `docs/plans/2026-08-22-approval-hands-the-work-to-agents.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Branch:** `feature/the-sections-carry-the-fleet-controls` (base: `main`)
- **Ends as:** one PR to `main`

Wave 1 (`feature/the-registry-knows-which-agents-live`) landed as **#327** — a
registry entry now carries a pid and a pulse-refreshed state. That is what makes
the stepper's number mean something. Wave 3 (`an-eligible-wave-starts-itself`)
does the dispatching and is not yours: **this wave builds the controls and
dispatches nothing.**

### What to build

Two controls, each on the section it describes:

    NOT STARTED header   [x] auto-dispatch      — is the queue being served?
    WORKING header       − 3 +  parallel agents — how many at once

Both read from `.plot/state/`, default from `## Plot Config` (switch **off**,
agents **3**), and are written through a new endpoint.

### The decisions the plan settles — do not re-derive them

**Each control belongs to the section it is ABOUT.** NOT STARTED holds work
nobody has taken, so the switch that says whether the queue is served goes
there. WORKING holds the running agents, so *how many may run at once* is a
statement about that section's contents. Read together they are the model:
*serve the queue* / *this many at a time*. Do not put both in one place.

**The state is SHARED, not per-viewer — and this is the plan's one real
departure.** The board's convention is that view state lives in the URL and
per-viewer convenience in `localStorage`; the collapse state's own comment draws
the line: *"a URL is shareable, and collapse state should not be… Collapse is
convenience, not subject matter."* Auto-dispatch fails that test in the opposite
direction — it spawns agents that write code and open PRs. Two people reading
one board must not disagree about whether the fleet is running.

**It lives in `.plot/state/`, beside the pulse the scan already writes there.**
Not in `CLAUDE.md`: teaching the board to edit a human-authored file would make
a checkbox arrive in a commit. `## Plot Config` supplies the DEFAULT at startup
and nothing more. Note `.plot/state/` is gitignored — that is correct and
intended.

**The stepper is a real `spinbutton`**, not two buttons beside a label, and it
refuses to go below 1. A cap of zero is a stopped fleet expressed as a number,
which the switch already says better.

**Turning either off is a promise about the FUTURE only.** It never signals a
running worker. Stopping work has a home already — the agent panel, per worker,
where the operator can see what would die.

**The endpoint refuses a cross-origin write exactly as `/api/dispatch` does** —
localhost binding, same-origin check. Import those guards; do not restate them.
A second copy of a security decision is a second place for it to be weakened.

### Done when

- The switch renders in NOT STARTED **only**; the stepper in WORKING **only**.
- Toggling and stepping **persist across a reload**, and a second board process
  reads the same values — that is what *shared* means and what a `localStorage`
  implementation would fail.
- The stepper refuses to go below 1 and announces its value.
- Both are keyboard reachable with state announced, and the stepper is a
  `spinbutton`.
- The endpoint refuses a cross-origin write.
- **Nothing dispatches.** A switch that is on starts no agent in this wave;
  wave 3 does that. A test should pin it.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board` committed, and a
changeset with its `bumps:` block. Never edit versions by hand. Use `trash`, not
`rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` section
on `main` once the PR exists — `git branch --show-current` must be `main` first.

### Scope guard

You own `packages/board/src/app/components/AgentList.tsx` (the two section
headers), the new endpoint in `packages/board/src/server/`, and their tests. You
do **not** own the dispatch loop (wave 3) or the registry (wave 1, landed).

`AgentList.tsx` was rewritten three times on 2026-08-22 and is the busiest file
in this repo. **Rebase before opening the PR.** On a conflict in
`board-server.mjs` do NOT read the diff — it is generated and marked `-merge`;
take either side, run `pnpm build:board`, commit the result.

Two other workers may be running, on the plan template and on `docs/plans/`
files. You share files with neither.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
