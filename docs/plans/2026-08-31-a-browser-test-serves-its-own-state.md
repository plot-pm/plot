# A browser test serves its own state

> 33 of 44 browser test files still spawn a real board. Each one binds a port,
> shells out to git and the host, and reads whatever the estate happens to say —
> so the suite is slow, order-dependent, and leaves servers behind when it hangs.
> The catalogue already replaced 11 of them; this finishes the job scenario by
> scenario rather than file by file.

## Status

- **Phase:** Approved
- **Type:** infra
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-31, Jan Wloka, in-session
<!-- Transition records — written by the workflow commands, not by hand:
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-08-31, Jan Wloka, `infra/the-browser-tests-say-which-need-a-server`
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
that has already been proven against the 248 tests the earlier slices moved.

### The exception list is declared and then verified

The gate this plan extends already refuses a hand-written list, and its
reasoning stands: *"a second place to update, and it fails open — a new stubbed
test simply is not on it."* A marker alone would reintroduce exactly that, one
line at a time.

So an exception **declares itself and is then checked**. A file that needs a
real board carries

```
// @needs-real-board: <reason>
```

and the gate verifies the claim structurally — the file must actually exercise a
write route or assert on process behaviour. A declaration the structure does not
support is an offence, so a test cannot join the exceptions by asserting that it
belongs there.

The signal is separable today: `lifetime.test.mjs` carries 71 process-shaped
references and no write-shaped ones, measured 2026-08-31. The marker supplies
the *reason*, which no predicate can infer; the structure supplies the
*entitlement*, which no comment should be trusted for.

### The counts stay exact, and each slice pays for them

`EXPECTED_FILES` and `EXPECTED_TESTS` remain hard-coded. They fired spuriously
once already — main added six tests mid-flight — and across seven slices that will
recur. That churn is the price of the tripwire rather than a flaw in it: raising
either number costs a visible line in the diff that raises it, which is the
whole mechanism. Every slice updates them in its own commit, against the main it
sits on and not by arithmetic on a stale figure.

### Open Questions

- [ ] How many scenarios is the right number? Too few and each test overrides so
      much that the scenario name means nothing; too many and the catalogue is
      33 fixtures with a new spelling. Measure after the second slice: if the
      average test overrides more than half the payload, the scenarios are
      wrong — and that measurement is a **gate**. The third slice does not start
      until the catalogue is re-cut. Migrating 33 files onto scenarios that
      already do not fit is how the fixture sprawl this plan exists to remove
      gets rebuilt under a better name.
- [ ] Does `tiny-garden` survive as a fixture repo at all? **34 files read it**,
      measured 2026-08-31 — far beyond the browser suite, so its fate is not
      this plan's to settle alone. The Survey records which of those consumers
      are browser tests and which are not; a fixture whose remaining readers are
      all process-behaviour tests may not need plans in it, but that is a
      finding this plan hands on rather than acts on.
- [ ] Is the assertion-count gate strong enough once files move between
      directories? It counts `it(` in `test/integration/`; a slice that moved a
      test to `test/unit/` would look like a deletion. Decide in the Deciding
      slice, before the first file moves.

## Branches

### Survey

- `infra/the-browser-tests-say-which-need-a-server` — read all 33 and classify each: catalogue candidate, must stay real (and why), or interception-over-baseline. Read-only; the output is a table in the plan, the wall-clock **baseline** for the whole suite on a stated machine and load, and the list of states `agents-tab.browser.test.ts` needs. First because the other slices' scope is unknown until it exists, and because "33 files" was an estimate — now checked: 44 browser files, 33 spawning a board, 365 tests between them.

  The baseline is taken here rather than later because a number nobody wrote
  down cannot be compared to one taken at the end, and *"faster is expected"* is
  not a measurement.

  It also reads `agents-tab` in full despite that file migrating last. Its 13
  `/api/fleet` routes are the best available statement of what the catalogue
  must express, and a catalogue shaped without them is one the largest consumer
  discovers it cannot use. Analysis early, migration late.

### Deciding

- `infra/the-gate-verifies-what-a-test-declares` — settle the two mechanisms the Survey's table implies, as a small code change: the declare-then-verify marker above, and whether the count assertion survives a file moving between directories. Separate from the Survey because a decision hidden inside a read-only report is one nobody reviewed; separate from Closing because the later slices move files and need the answer first.

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

- The gate refuses any browser test file that starts a board without declaring
  `@needs-real-board`, and refuses a declaration the file's structure does not
  support — so a new test cannot join the exceptions by claiming to belong
  there, which is the failure a bare list or a bare marker both allow.
- The assertion count is unchanged except where a slice's changeset names the
  tests it added, and the count is asserted rather than reviewed.
- **A named scenario, changed in one place, changes what every test using it
  sees** — asserted by changing one and watching the dependent tests fail, not
  by reading the code.
- The suite's wall-clock time is measured in the Survey and again at the end,
  both on a stated machine and load, and stated in the final changeset. Faster is expected; the number matters more than the
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
