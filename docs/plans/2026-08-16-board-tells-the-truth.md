# The board is confident about things it cannot see

> A view whose job is to say *what is true right now* has three ways of
> sounding certain while knowing nothing: a dead server that still ticks, a
> port nobody can find, and a test that fails for a reason unrelated to the
> code.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-16, jwloka, plan-PR #138 merged
- **Started:**
- **Delivered:**

## Problem

Three incidents on 2026-08-16, raised separately, sharing one shape: **the
board reports confidently on state it has not observed.** Each was found the
same way — by running the thing, never by reading it.

**A board whose server died looks like a board that is working.** Two
screenshots reported regressions ("the nameless heading is still there", "the
group's plan link is still missing"). Both were the frozen last render of a
page whose server had stopped; on the live board neither was true. The
diagnosis took three wrong hypotheses — stale bundle, JSX guard, minification —
before anyone checked what was actually running. A rebuild that produced a
**byte-identical** artifact should have ended it and did not.

**A port nobody can find.** The frozen page was on `:7930`; the live server was
on `:7777`. Neither page could say which. The same evening, `pnpm board`
refused to start with `EADDRINUSE` because a board was already up — and the
story already records the extreme case: **seven** independent board-servers on
seven ports, accumulating one per terminal, at **80 GraphQL calls/hour each**.

**A test that fails for reasons unrelated to the code.** PR #131's `validate`
failed on `a plans dir NESTED in an unrelated repo borrows nothing from it`;
the identical commit passed on rerun. It gates CI, so every occurrence costs a
diagnosis to rule out a real regression.

### The three are one cause, twice over

Measured, not assumed — and it corrected a wrong first guess. The flake was
attributed to "a test that waits on a clock". There are **no sleeps in the
file**; the runtime comes from real `git init`/`commit` calls. The actual
mechanism is in `helpers.mjs:19`:

```js
export function findFreePort() {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));   // <- port is free again HERE
  });
}
```

Bind port 0, read the number, **close**, hand the number to a different process
that binds it later. Between `close()` and the server's `listen()` the port
belongs to nobody, and CI runs test files in parallel on one machine. That is a
time-of-check-to-time-of-use race, and it is the **same defect** as
`EADDRINUSE` on `pnpm board` and as a bookmarked tab pointing at a dead port:
**a port is chosen at one moment and used at another, with nothing carrying the
answer between them.**

So two branches, not three: the port race is one problem wearing two costumes.

## Design

### 1. The page says when it last heard from its server

Three things combine today, each defensible alone:

- **The Agents tab never consults `fleet.error`.** `AgentList` reads it only to
  choose the pre-first-scan message (line 326); afterwards the error state has
  no rendering at all. `App.tsx:383` does show *"Failed to load board"* — but
  that branch renders the **Board**, so the sibling tab reports the outage
  while Agents keeps drawing its last payload.
- **The clock keeps running.** `tick` advances every second while
  `pollSeconds !== null`, and `pollSeconds` is the constant `FLEET_POLL_MS /
  1000` — never null with the tab open. A failed fetch changes nothing. So
  `scanNextInSeconds − tick` counts to 0 and clamps ("next in 0s", which reads
  as *about to refresh*, not *stopped*), while `ageSeconds + tick` ages on,
  describing a scan that is not happening.
- **Rows keep their normal styling**, so nothing separates a two-second-old
  truth from a two-hour-old one.

The fix states the failure where the reader is looking: **a fetch that fails
marks the payload stale, and the stale state is visible in the tab that owns
it.** The countdown stops rather than clamping at zero — a counter that reads
*next in 0s* forever is a claim, and a false one.

The rule is already written in the file, at line 313: *"a counter ticking
toward a refresh that is not coming is exactly the false statement the
countdowns exist to remove."* It was implemented for a **closed tab** and
misses a **dead server** — the same absence-ambiguity this story keeps
producing, one layer up: *stopped polling* and *polling and failing* are
indistinguishable to the reader.

**The first failed fetch is enough.** No two-strikes rule, because the two
outcomes are not symmetric. A fetch that fails **is** an unobserved state, and
what the reader sees in response is mild — the clock stops, a marker appears —
so a network hiccup that briefly reads *last heard 4s ago* costs nothing and
self-corrects on the next poll. A dead server that looks normal for two poll
intervals costs a misdiagnosis, which is what this plan is paying off. Waiting
for a second failure buys quiet flicker at the price of up to 8 seconds in
which the numbers are wrong and say nothing about it.

**It recovers by itself.** A successful fetch clears the stale state and the
clock resumes — no reload, because the polling never stopped and asking the
reader to confirm a recovery the page can observe is ceremony. With a
first-failure threshold this matters: a hiccup would otherwise strand the view
in permanent distrust until someone pressed reload.

**The first-load failure keeps its own message.** `!fleet.ready &&
!fleet.error` already renders *"Waiting for the first fleet scan…"*, and that
is a different statement from *"this data is old"* — one has never had an
answer, the other has one it no longer trusts. Collapsing them would make an
empty view claim staleness it cannot have. The two states stay separate.

**Degrade, do not hide.** The last payload stays on screen — it is still the
best information available, and blanking the view would destroy what the reader
came for. What changes is the *confidence*: the ages stop advancing, and the
tab says how long ago the last answer arrived.

### 2. A port is bound once, and the binder reports it

**`PORT=0` binds zero and reports what the OS gave; everything else is
unchanged.** The first draft of this section said "the server binds port 0",
and checking the code showed why that is wrong: `index.ts:15` reads
`process.env.PORT ?? 7777`, and the fixed default is a feature. A development
board on a random port is not bookmarkable, and `pnpm board` would land
somewhere new every time — turning tonight's dead-bookmark incident from an
accident into the rule.

Tests and the dev board want opposite things, and the fix should say so rather
than pick one. Tests want **isolation**: no shared number, no collision. The
dev board wants **predictability**: the same address every day. `PORT=0` serves
the first without touching the second — the OS assigns during `listen()`, the
process reads its own `address()` and prints it, and there is never a moment
when a port is known-free but unbound.

**The bound port must reach the origin check, and today nothing forces it to.**
The sharp edge of this change, found by reading rather than assuming. A port is
not only an address here: `dispatch.ts:154` calls `isSameOrigin(req,
opts.port)`, which admits a browser `Origin` only when it matches
`localhost:<port>` — and it guards `/dispatch`, the endpoint that **spawns
processes**. `index.ts:15` evaluates `const PORT` at module load, before
`server.listen()` runs. Under `PORT=0` the constant stays `0` while the real
port is something else, so the allowlist would read `http://localhost:0` and
refuse **every** browser origin.

So the fix reads `server.address().port` inside the `listen` callback and
passes *that* to `handleDispatch`. It corrects an inconsistency that exists
already — the constant and the bound port are two separate facts today, and
nothing makes them agree; `PORT=0` only makes the gap impossible to ignore.
Failing closed is the safe direction, but a Start-work button that silently
stops working is still a bug.

**`startServer` already knows the answer and discards it.** It waits for
`http://localhost:` in stdout — and that line carries the real port — but
resolves with the port it was *given* (`helpers.mjs:41–68`). Parsing
`http://localhost:(\d+)` out of the line it is already reading turns 28 call
sites into a one-line change inside the helper: no new protocol, no port file
to write and clean up, and no second way to learn the same fact.

`findFreePort` is deleted, not fixed: a retry loop on `EADDRINUSE` makes the
race rarer instead of impossible, and a test that fails once in fifty runs is
harder to diagnose than one that never does — which is exactly the cost this
plan is paying off.

**All 28 call sites move together.** Counted, because "delete the helper" read
like a footnote and is not: `findFreePort` is called 28 times across 8 test
files — `board`, `claimed`, `discovery`, `dispatch` and four integration
suites. Migrating one file would fix the flake that has been *seen* while
leaving the same race in seven that have merely not failed yet, and would keep
the helper alive for the next test file to reach for. The change is mechanical
and uniform: large in line count, small in risk.

**`pnpm board` reports the running board and exits, rather than starting a
second.** Same root, daily cost: seven boards accumulated on 2026-08-16, each
polling at 80 GraphQL calls/hour, because nothing connects a new invocation to
an existing one.

"Adopt" means **name it and stop** — print `board already running at
http://localhost:7777` and exit 0. Not "kill the old one and start fresh": a
`pnpm board` in one terminal would then shoot down the board of another
worktree, and several worktrees ran side by side on the very day this was
found. Reporting also needs no process communication and is trivial to assert,
while giving the reader exactly the fact that was missing tonight — *which
address is alive*.

Today the second invocation dies with a raw `EADDRINUSE` stack trace, which
states the problem in the least useful available form: it says a port is taken
without saying by what, or where to go instead.

**The failed bind IS the check.** Catch `EADDRINUSE` from `listen()` rather
than asking beforehand whether the port is free. Probing first would reproduce,
inside this very plan, the pattern the plan exists to remove: *check, then act*,
with a gap in between where the answer can change. One less race, and the error
path already exists — it only needs to say something useful.

**And the page can say which port serves it.** The bookmarked-dead-port case is
unfixable from inside a page that cannot name its own origin; with the port
reported, the staleness banner in part 1 can say *where* it is not hearing
back from.

### 3. The suite stops racing

`discovery.test.mjs` and every other caller move to the started-server port.
This is the smallest of the three and the only one CI gates, so it lands
independently of the rest.

Worth stating because the first diagnosis was wrong: the file's 9.2 s runtime
is **not** the problem and must not be "optimised". It spawns real git repos on
purpose — that is what makes the containment assertions real. Speed is not the
fix; determinism is.

## Branches

### Truth

- `bug/board-shows-staleness` — a failed fetch marks the payload stale in the
  Agents tab; the countdown stops rather than clamping at zero; the ages stop
  advancing; the last payload stays on screen

### Ports

- `bug/board-binds-port-zero` — `PORT=0` binds zero and reports the assigned
  port (default 7777 unchanged); `findFreePort` is deleted and all 28 call
  sites across 8 test files read the started server's port; a second
  `pnpm board` names the running one and exits

**One at a time, and the reason is the artifact, not the sources.** Checked at
dispatch: `agent-view-phase`'s Data wave holds `fleet.ts`, `schema.ts`,
`plot-fleet-scan.sh` and `plot-plan-meta.sh`; this plan wants `AgentList.tsx`,
`App.tsx`, `index.ts`, `dispatch.ts` and `helpers.mjs`. **Zero source
overlap.** But both must run `pnpm build:board` and commit
`skills/plot/scripts/board/board-server.mjs`, a minified bundle where any two
concurrent rebuilds collide and the conflict cannot be meaningfully resolved.
That is the open point already recorded in
[`plot-board`](../stories/plot-board/STORY-plot-board.md) — *the checked-in
artifact collides on every parallel branch* — and until it is fixed it bounds
how parallel board work can actually be.

So the two waves here are genuinely parallel with each other in *source* terms:
the first touches `AgentList.tsx`/`App.tsx`, the second the server bootstrap,
the test helpers and the `board` script. Neither touches `plot-fleet-scan.sh` or
`packages/board/src/server/fleet.ts`, which
[`agent-view-phase`](2026-08-16-agent-view-phase.md) holds while its first wave
is in flight.

## Done when

- **A failed fetch is visible in the Agents tab.** Assert the tab renders a
  stale marker when `fleet.error` is set after a successful first scan — the
  case today's code has no rendering for at all.
- **The countdown stops rather than clamping.** Assert it does not read
  `next in 0s` while the payload is stale: clamping at zero is the current
  behaviour and reads as *about to refresh*.
- **The ages stop advancing when nothing is arriving.** Assert `ageSeconds +
  tick` freezes; a test that only checks the banner passes with the clock still
  running underneath it.
- **The last payload stays on screen.** Assert the rows are still rendered —
  degrading must not become hiding.
- **The first failed fetch marks the payload stale.** Assert on ONE failure —
  a two-strikes implementation passes a test written against two.
- **No port is chosen before it is bound.** Assert `findFreePort` no longer
  exists and that **no** test file passes a port in — all 28 call sites, not
  the one that was seen to fail. This is the assertion that fails if someone
  later "restores" the helper for convenience.
- **The server reports the port it actually bound**, asserted against a request
  that reaches it — not against the number it intended to use.
- **`/dispatch` still accepts a same-origin request under `PORT=0`.** The
  assertion that catches the whole class: send an `Origin` header matching the
  *bound* port and require a non-403. A dispatch endpoint that fails closed
  looks like nothing is wrong until someone presses Start work.
- **A stale view recovers on the next successful fetch** without a reload, and
  the clock resumes. Assert the recovery, not only the failure — a stale flag
  that is never cleared passes every test that only checks it gets set.
- **The first-load message is not the staleness message.** Assert that a tab
  which has never had an answer still says so: they are different statements,
  and merging them makes an empty view claim data it never had.
- **A second `pnpm board` does not probe before binding.** Assert the running
  board is detected via the failed `listen`, not a prior port check — probing
  first rebuilds the exact race this plan removes.
- **The default port is unchanged.** Assert that starting without `PORT` still
  binds 7777: the isolation belongs to the tests, and a fix that made the dev
  board wander would trade one lost-address problem for a permanent one.
- **A second `pnpm board` reports the first and exits 0.** Assert it does not
  start a second server AND that it names the address — exiting quietly would
  leave the reader with the same question tonight's `EADDRINUSE` left them
  with. Assert it does not kill the running one either.
- **The nested-repo containment assertions still hold** — they are the reason
  the slow test exists, and a port fix that weakened them would trade a flake
  for a hole.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run in the implementing worktree and the artifact
  committed — CI gates on no-diff.
- A changeset is present.

## Notes

Gathered 2026-08-16 from three incidents in one session. Each cost real time:
the dead board cost a three-hypothesis misdiagnosis, the ports cost a failed
restart and seven accumulated servers, the flake cost a CI investigation on a
plan PR that was never broken.

Deliberately **not** in scope: `local_ahead` — reporting commits that exist
locally but are not pushed. It belongs to the same theme (the board cannot see
what git has not been told) and is already measured: `git rev-list --count
origin/<br>..<br>` costs 5.75 ms per call against the 6.6 ms/worktree
`fleet-sees-local-work` already accepts, and a missing upstream exits **128
with empty output** — bit-identical to the deleted-worktree signature that plan
already handles, so it reuses that rule rather than inventing one. It is
excluded because it touches `plot-fleet-scan.sh` and `fleet.ts`, the two files
`agent-view-phase` holds right now. Its own bug plan, after that merges.

The case for `local_ahead` is not hypothetical: on 2026-08-16 an agent finished
three commits on `bug/fleet-sees-local-work` and paused before pushing. The
worktree was clean, so `local_dirty` was false, and the board read *"claimed,
no commits yet"* for a branch holding a complete implementation — including the
commit that fixed the neighbouring half of the same blindness.

Also **not** in scope, found while this plan's own PR was open: a Draft plan's
branches appear under NOT STARTED reading *"eligible — nobody has taken it"*.
Measured: `plot-fleet-scan.sh` contains **zero** references to a plan's phase —
it walks every active plan's waves whether the plan is Draft or Approved. So
the tab invites a dispatch that `plot-dispatch` would refuse, on work still
under discussion. It belongs with
[`agent-view-phase`](2026-08-16-agent-view-phase.md), which is teaching exactly
this connection — there for the row's *label*, here for its *group* — and it
touches `plot-fleet-scan.sh`, which that plan holds.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "The plan says 'the server binds port 0', but index.ts:15 reads process.env.PORT ?? 7777 — a FIXED port. Tests and the dev board want opposite things.", "a": "PORT=0 opt-in: binds zero and reports it; default 7777 unchanged. Tests get isolation, the dev board keeps a bookmarkable address", "category": "technical-architecture"},
    {"q": "findFreePort has 28 call sites across 8 test files, not just discovery.test.mjs. How big is the branch?", "a": "All 28 at once. A half-migrated helper leaves the race in 7 files that merely have not failed yet, and keeps the helper alive for the next test to reach for. Mechanical and uniform: large in lines, small in risk", "category": "technical-implementation"},
    {"q": "What does 'pnpm board adopts a running board' mean concretely?", "a": "Name it and stop — print the address, exit 0. NOT kill-and-restart: that would shoot down another worktree's board, and several ran side by side the day this was found", "category": "domain-workflows"},
    {"q": "When is a payload stale? One failed fetch could be a hiccup.", "a": "First failure. The outcomes are asymmetric: a brief false 'last heard 4s ago' costs nothing and self-corrects; a dead server looking normal for two intervals costs a misdiagnosis", "category": "ux-errors"},
    {"q": "isSameOrigin(req, PORT) guards /dispatch, which spawns processes — and const PORT is evaluated at module load, before listen(). Under PORT=0 the allowlist would read localhost:0 and refuse every browser origin.", "a": "Read server.address().port in the listen callback and pass THAT to handleDispatch. Corrects a latent inconsistency that exists today; PORT=0 only makes it visible", "category": "nonfunctional-security"},
    {"q": "How do tests learn the bound port?", "a": "Parse it from the stdout line startServer already waits on — the line carries it and the helper discards it. One line in the helper instead of a port file, a new protocol, or 28 edits", "category": "technical-implementation"},
    {"q": "How does pnpm board detect a running board?", "a": "Catch EADDRINUSE from listen(). The failed bind IS the check — probing first would rebuild the check-then-act race this plan exists to remove", "category": "technical-architecture"},
    {"q": "What happens when the server comes back, and what about a failed FIRST load?", "a": "Recovers automatically on the next successful fetch, no reload. The first-load message stays separate: never-had-an-answer is a different statement from no-longer-trusted", "category": "ux-edgecases"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": false, "workflows": true, "data": false},
    "ux": {"happyPath": false, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": true, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
