# Brief: feature/the-board-renders-what-has-arrived

Implement the *Cadence* wave branch of
`docs/plans/2026-08-18-the-scan-asks-once-not-once-per-branch.md`.
Read the plan first. Wave 1 (`bug/the-scan-joins-one-pr-list`, #232) is merged.

## The measurement

Taken on this repo 2026-08-19, after #232 landed:

| Fact | Value |
|---|---|
| board refresh interval | **5 s** (`packages/board/src/server/fleet.ts:45`, `REFRESH_MS`) |
| a full scan | **18.3 s** |
| scan timeout | 30 s (`fleet.ts:262`) |
| git alone, 84 branches | 12.7 s |

The board asks every 5 s for something that takes 18 s. **Even a perfect host
fix cannot close this** — git alone is 12.7 s, so the wait is structural and
the only thing that removes it is not waiting for the whole document.

## What to build

**The scan emits results as they resolve; the board renders each row with the
sources it has and marks the rest as not-yet-arrived.**

Three sources resolve at three speeds — plan facts (instant, local files), git
facts (seconds, local refs), host facts (slowest, network). A row does not need
all three to be worth showing.

**A badge whose source has not arrived is absent, not zero and not guessed.**
This is the rule the whole board is built on and it is the one that makes this
change safe: a count of 0 rendered before anything was counted is a measurement
never taken displayed as one that was. `not-yet-asked-is-not-nothing` (merged)
established the vocabulary — reuse it rather than inventing a second one.

**A scan that fails midway keeps what arrived** and says the rest is unknown.
Discarding a partial result throws away facts that were correctly measured.

**A completed scan must render identically to today's.** This is the assertion
that proves the change is about *when* rows appear, not *what* they say.

## Definition of Done

- A row renders from plan facts before any git fact exists
- A badge whose source has not arrived is absent — never zero, never guessed
- A completed scan renders identically to today's — assert this explicitly
- A scan that fails midway keeps what arrived and marks the rest unknown
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not change what any row *says* once its sources have arrived
- Do not implement the terminal-branch cache or the per-host refresh cost —
  those are the sibling branches `feature/a-terminal-branch-is-asked-once` and
  `bug/the-cadence-knows-what-a-refresh-costs`
- Do not lower `REFRESH_MS` to paper over the wait

## Platform and machine notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially.

**Other agents are running on this machine.** If `test:board` gives you
connection-refused failures, a sibling worktree's board server is the likely
cause. Kill only servers you started — `pkill -f board-server.mjs` matches
every board on the machine including the operator's, and doing that killed a
live board twice today. Bind `PORT=0` and record your own pid.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
