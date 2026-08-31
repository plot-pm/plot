# A browser test serves its own state

> 33 of 44 browser test files still spawn a real board. Each one binds a port,
> shells out to git and the host, and reads whatever the estate happens to say —
> so the suite is slow, order-dependent, and leaves servers behind when it hangs.
> The catalogue already replaced 11 of them; this finishes the job scenario by
> scenario rather than file by file.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- The browser suite states the board state it is testing instead of inheriting
  whatever the repository happens to contain, so a failure names a payload
  rather than a moment.

Board impact: tests only. No production source, no plan format, no helper
scripts. The artifact is rebuilt because the suite runs against it.

## Motivation

**Measured 2026-08-31:**

| | files | tests |
|---|---|---|
| serve their own state (catalogue) | **15** | 95 |
| spawn a real `board-server.mjs` | **33** | **388** |

`a-ui-test-needs-data-not-a-board` migrated 11 files and shipped the gate that
stops new ones appearing. That gate fires only on files which supply **both**
`/api/board` and `/api/fleet`, so the 33 are outside it **by construction** —
they legitimately read real payloads today. It is a ratchet against regression,
not a mandate, and this plan is the mandate.

### What a real server costs, beyond time

Each of those 33 starts a process that binds a port, spawns `plot-plan-meta.sh`
and `plot-host.sh` children, and reads the estate as it is at that instant.
Three consequences, each measured rather than argued:

**It leaves servers behind.** 2026-08-31: two `vitest` processes asleep at 0 %
CPU for 33 and 47 minutes, holding an orphaned board server at 135 MB. Load
average 6.03 on a machine that should have been idle. `a-hung-launcher-is-not-a-live-one`
closes that with an idle gate and a run bound — **and a test that starts no
server cannot orphan one at all.** The guard is the seatbelt; this is not
driving into the wall.

**It makes a failure ambiguous.** When a suite reads the real estate, a red test
may mean the code broke, the estate moved, or the host was throttled. This
evening produced all three, and told them apart only by re-running against a
different machine state.

**It makes the assertion vague.** A test that says *"a row appears"* about
whatever the repo contains cannot say *"THIS state renders THAT"*. The round
trip the catalogue exists for — the server declares a state, the board shows
exactly that state — is unavailable to a test whose input is the world.

### The gap this closes, stated as the goal

> If the server delivers a given state about a plan, a slice or an agent, the
> board shows exactly that.

That is checkable only when a test **names** the state. 388 tests currently
cannot.

## Design

### The unit is a scenario, not a file

**The catalogue has three scenarios** — `a-done-wave`, `an-eligible-wave`,
`an-empty-estate` — against 388 tests that need states. Migrating file by file
would mean inventing a payload per file, which is how a fixture set becomes 33
subtly different descriptions of one board.

So each slice below **adds the scenarios a group of tests needs**, then moves
that group. The scenario is the deliverable; the file move is what proves it is
usable. A scenario earns its name from the state it describes, not from the file
that first wanted it.

### What the migration must not lose

**Assertion count.** The gate already asserts the number of `it(` in the
directory, and `a-ui-test-needs-data-not-a-board` records why: *"the grep passes
trivially if the migration DELETES tests instead of moving them."* That number
moves only when a slice deliberately adds a test, and the changeset says so.

**The real-server tests that must stay real.** Not every file is a candidate,
and finding out which is part of the first slice rather than an assumption:

- `lifetime.test.mjs` and its kin test *the server's own process behaviour* —
  the parent gate, the idle gate, the port binding. A mock has no process.
- `write-gate.test.mjs` and the approve/dispatch routes exercise **writes** that
  reach scripts. A mock that accepted them would assert nothing.
- `tiny-garden.browser.test.ts` reads a fixture repo on purpose; whether that is
  a real-server test or a catalogue scenario is a judgement, not a grep.

**The one thing the catalogue cannot serve**, and `unreachable-overlay` is the
worked example: a board that *cannot answer*. `abort`, HTTP 500, malformed JSON.
Those stay `page.route` interceptions layered over a served baseline — the
pattern that file now demonstrates.

### The order, and why it is not "largest first"

`agents-tab.browser.test.ts` holds **117 of the 388 tests** — a third of the
work in one file. It is deliberately **last**. Its own comment explains that it
routes `/api/fleet` thirteen times while reading the real `/api/board`
everywhere else, *"because a real repo /api/board takes seconds"*; a file that
mixed is the one most likely to need scenarios the earlier slices produced.

Migrating it first would mean inventing every scenario at once, under the
pressure of the largest file. Migrating it last means it inherits a catalogue
that has already been proven against 271 other tests.

### Open Questions

- [ ] How many scenarios is the right number? Too few and each test overrides so
      much that the scenario name means nothing; too many and the catalogue is
      33 fixtures with a new spelling. Measure after the second slice: if the
      average test overrides more than half the payload, the scenarios are wrong.
- [ ] Does `tiny-garden` survive as a fixture repo at all? Several files read it
      through a real server. If every one of those migrates, the fixture's only
      remaining consumers are the process-behaviour tests — which may not need a
      repo with plans in it.
- [ ] Is the assertion-count gate strong enough once files move between
      directories? It counts `it(` in `test/integration/`; a slice that moved a
      test to `test/unit/` would look like a deletion. Decide before the first
      slice moves one.

## Branches

### Sorting

- `infra/the-browser-tests-say-which-need-a-server` — read all 33 and classify each: catalogue candidate, must stay real (and why), or interception-over-baseline. Output is a table in the plan, not code. First because the other slices' scope is unknown until it exists, and because "33 files" is an estimate nobody has checked.

### Naming

- `infra/the-catalogue-names-the-states-the-suite-needs` — add the scenarios the classification calls for, each with a name that says what state it is. No file moves; the deliverable is a catalogue that can express the suite.

### Moving the plans

- `infra/the-plan-tab-tests-serve-their-own-state` — migrate the board/Plans-tab files onto the new scenarios. The smaller half, and the one whose payload (`/api/board`) is simplest.

### Moving the agents

- `infra/the-agents-tab-tests-serve-their-own-state` — the fleet-side files, excluding `agents-tab` itself. `/api/fleet` carries rows, waves, agents and summary, so this is where the scenarios are exercised hardest.

### The big one

- `infra/the-agents-tab-test-serves-its-own-state` — `agents-tab.browser.test.ts` alone, 117 tests, on a catalogue proven by everything above.

### Closing

- `infra/every-browser-test-serves-its-own-state` — extend the gate from *"a fully-stubbed file must not start a board"* to *"only the classified exceptions may"*, with the exception list derived from the Sorting slice rather than hand-maintained.

## Done when

- The gate refuses any browser test file that starts a board and is not on the
  classified exception list, and the list is **derived** rather than written by
  hand — a new test cannot join it by being added to an array.
- The assertion count is unchanged except where a slice's changeset names the
  tests it added, and the count is asserted rather than reviewed.
- **A named scenario, changed in one place, changes what every test using it
  sees** — asserted by changing one and watching the dependent tests fail, not
  by reading the code.
- The suite's wall-clock time is measured before and after and stated in the
  final changeset. Faster is expected; the number matters more than the
  direction, because a migration that did not speed it up means the servers were
  not the cost and something else should be looked at.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset.

## Notes

**This plan exists because the guard is not the fix.**
`a-hung-launcher-is-not-a-live-one` (shipped 2026-08-31) makes an orphaned
server exit after five minutes of silence and bounds `test:board` at 1200 s.
That stops the damage; it does not stop the cause. A test that starts no server
has nothing to orphan, nothing to bind, and nothing to wait for.

**The precedent is worth reading before starting.**
`a-ui-test-needs-data-not-a-board` migrated 11 files and its last one —
`unreachable-overlay` — took two agents and most of an evening. What made it
hard was not the mechanics: its fleet fixture was a **raw literal cast to
`Fleet`**, structurally valid to `tsc`, never `.parse()`d, and silently missing
its `waves` array. It rendered no action menu, and nobody noticed because a real
server had been quietly supplying what the fixture omitted.

**That is the general shape of this work.** Serving the whole state exposes
fixtures that were always incomplete; only the real dependency was hiding it.
Expect each slice to find some, and expect the finding to be the value rather
than an obstacle — a fixture that renders nothing is a test that was asserting
nothing.

**Use the builders, never a literal.** `row()`, `wave()`, `card()`, `fleet()`,
`board()` take `Partial<…>` and `.parse()` through Zod, so a stale field name
fails at compile time and a wrong shape fails at serve time. A JSON fixture can
do neither, which is exactly how the drift above survived.
