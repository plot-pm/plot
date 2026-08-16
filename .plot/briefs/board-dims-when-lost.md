## Implementation brief — board-says-it-lost-its-server

- **Plan (canonical):** `docs/plans/2026-08-17-board-says-it-lost-its-server.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #150 merged (two interrogation rounds)
- **Branch:** `feature/board-dims-when-lost` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

`board-tells-the-truth` (#141) made the board stop **lying** when its server
goes away: a rose banner, `(frozen)` in the footer, stopped clocks. This makes
it stop **inviting**. Rows keep full contrast, links keep their affordance, and
the row action menu keeps offering `Start work` on data minutes old.

The banner says *these numbers are old*. What is missing is *do not operate this
right now*.

Two escalating states: **banner alone** for a short silence, **dimming** after a
sustained one.

### Five decisions the plan settles — do not re-derive them

**Count missed polls, not seconds.** Measured: `POLL_MS = 30_000` (board) and
`FLEET_POLL_MS = 4_000` (fleet) — a factor of 7.5. One seconds-based threshold
would mean *seven and a half missed polls* on one tab and *a single one* on the
other, dimming on the first hiccup in one place and only after a real outage in
the other. A consecutive-failure count keeps the statement identical on both and
survives someone changing an interval later.

**How many is yours to measure**, and to justify in the PR. `pnpm board` runs
under `node --watch`, so an ordinary edit to a board source file restarts the
server and the tab loses contact several times an hour. Pick a count that
comfortably outlasts a real restart — a number guessed in a plan file carries
the authority of a decision without the measurement behind it.

**Both tabs, which means unifying two error models.** This is the largest part
of the work and the one that is a *behaviour change* rather than an addition.
Today silence is measured for the Agents tab only (`if (tab !== 'agents' ||
!fleetUnreachable || fleetHeardAt === null) setFleetStaleSeconds(null)`), and
the two tabs answer the same outage in opposite ways: the Agents tab keeps its
rows, the Board tab sets an `error` string and **replaces its cards** with a red
message (`App.tsx:383`), discarding a payload it still holds. The Board tab gets
the newer treatment — *degrade, do not hide* — applied where it has not reached
yet.

**Blocked means interaction with the board**, not everything. Reading needs no
clicks and never stops: scrolling, selecting, copying a branch name. What stops
is clicking cards, filtering, triggering actions, operating columns — the
surface whose data is stale. The overlay's own message and restart command stay
usable, because blocking the way out would be a dead end with a lock on it. An
**already-open plan modal stays usable**; its content route may fail, and it has
its own error path for that. Opening a *new* one is board interaction and stops.

**A server that answers badly does not dim.** HTTP 500, malformed JSON,
`{ error: … }` — the server is alive and speaking. The overlay would claim *no
contact* and be plainly wrong, and `pnpm board` would be the wrong advice. The
existing `setError` path keeps that case: two faults, two messages.

### The message

*"No contact with the board server for N polls"* plus the restart command and
the address.

**The command comes from the server**, travelling with the last successful poll
— `pnpm board` is *this* repo's convention, and Plot hardcodes no project
conventions (Principle 5). It also names the **port this page was served from**:
if the server returns on a different one — which happened this session, when an
agent started a second board from its worktree — the overlay correctly stays up,
because a page can only ask its own origin. Do **not** probe other ports: a page
that guesses could attach itself to another project's board.

**Returning to a backgrounded tab re-checks rather than counts.** Browsers
throttle hidden timers, and `App.tsx` already warns: *"a board that has heard
nothing for an hour has to say an hour, not 'as many seconds as the browser felt
like waking me'."* Trigger a poll on visibility change — it either succeeds and
the overlay goes, or it fails and the overlay is honest.

**Blocked actions stay visible and `aria-disabled` with a reason**, not removed
— the same pattern `working-rows-show-motion` settles for the row action menu.
Vanishing buttons make the layout jump twice: on loss and again on recovery.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist
because a weaker implementation passes without them:

- **A short silence dims nothing** — one failed poll leaves the page operable
  with only the banner.
- **The threshold is counted in polls** — assert both tabs dim after the same
  *number of failures* despite the 7.5× rate difference.
- **Both tabs dim** — assert the Board tab reaches the state at all; today it
  only ever sets an `error` string, so an Agents-only implementation passes
  every other test here.
- **The Board tab keeps its last cards** rather than replacing them.
- **A server answering badly does not dim** — assert HTTP 500 and malformed
  JSON leave the overlay off.
- **The overlay's own controls stay usable** while the board's do not.
- **Returning to a hidden tab re-checks** — assert a poll is issued on
  visibility change.
- **The command and port come from the payload**, not a client constant —
  assert a different value round-trips.
- **The overlay is announced, not merely drawn** — a visual dim tells a screen
  reader nothing.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run
validate` all pass; `pnpm build:board` run **in your own worktree** and the
artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists** — this repo lost sight of finished work three times on one branch
today because it was never pushed.

### Scope guard

`packages/board/src/app/App.tsx`, a new overlay component, the contract field
carrying the restart command and port, and their tests.

Four branches are in flight. `App.tsx` is **yours alone**, but note:
`feature/agent-groups-collapse` holds `AgentList.tsx` and the row sort in
`fleet.ts`; `feature/fleet-row-says-blocked` holds `classify()` in `fleet.ts`
and `schema.ts`; `feature/board-column-overflow` holds `Board.tsx`, `board.ts`
and `schema.ts`. **`schema.ts` is contested** — keep your contract addition
narrow and rebase rather than race.

`.gitattributes` marks the built artifact `-merge`: on a conflict there, take
either side, run `pnpm build:board`, `git add` it, continue. Do not read that
diff — and expect it, because every board merge invalidates every open board
branch's artifact.

**Explicitly out of scope:** the IPv4/IPv6 case. On 2026-08-16 the board read as
unreachable while running perfectly — it listened on `[::1]:7777` and Chrome
resolved `localhost` to `127.0.0.1`. No overlay helps there, because the
document never loads. It is a separate recorded finding.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
