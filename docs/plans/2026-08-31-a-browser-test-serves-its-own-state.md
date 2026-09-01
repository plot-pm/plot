# A browser test serves its own state

> 33 of 44 browser test files still spawn a real board. Each one binds a port,
> shells out to git and the host, and reads whatever the estate happens to say —
> so the suite is slow, order-dependent, and leaves servers behind when it hangs.
> The catalogue already replaced 11 of them; this finishes the job scenario by
> scenario rather than file by file.

## Status

- **Phase:** Delivered
- **Type:** infra
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-31, Jan Wloka, in-session
<!-- Transition records — written by the workflow commands, not by hand:
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-08-31, Jan Wloka, `infra/the-browser-tests-say-which-need-a-server`
- **Started:** 2026-08-31, Jan Wloka, `infra/the-gate-verifies-what-a-test-declares`
- **Started:** 2026-09-01, Jan Wloka, `infra/the-catalogue-names-the-states-the-suite-needs`
- **Started:** 2026-09-01, Jan Wloka, `infra/every-browser-test-serves-its-own-state`
- **Delivered:** 2026-09-01
- **Delivered:** 2026-09-01
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

- `infra/the-browser-tests-say-which-need-a-server` — read all 33 and classify each: catalogue candidate, must stay real (and why), or interception-over-baseline. Read-only; the output is a table in the plan, the wall-clock **baseline** for the whole suite on a stated machine and load, and the list of states `agents-tab.browser.test.ts` needs. First because the other slices' scope is unknown until it exists, and because "33 files" was an estimate — now checked: 44 browser files, 33 spawning a board, 365 tests between them. → #575

  The baseline is taken here rather than later because a number nobody wrote
  down cannot be compared to one taken at the end, and *"faster is expected"* is
  not a measurement.

  It also reads `agents-tab` in full despite that file migrating last. Its 13
  `/api/fleet` routes are the best available statement of what the catalogue
  must express, and a catalogue shaped without them is one the largest consumer
  discovers it cannot use. Analysis early, migration late.

### Deciding

- `infra/the-gate-verifies-what-a-test-declares` — settle the two mechanisms the Survey's table implies, as a small code change: the declare-then-verify marker above, and whether the count assertion survives a file moving between directories. Separate from the Survey because a decision hidden inside a read-only report is one nobody reviewed; separate from Closing because the later slices move files and need the answer first. → #576

### Naming

- `infra/the-catalogue-names-the-states-the-suite-needs` — add the scenarios the classification calls for, each with a name that says what state it is. No file moves; the deliverable is a catalogue that can express the suite. → #582

### Moving the plans

- `infra/the-plan-tab-tests-serve-their-own-state` — migrate the board/Plans-tab files onto the new scenarios. The smaller half, and the one whose payload (`/api/board`) is simplest. → #585 → #588

  **Split in two while running.** The Plans-tab payload pair landed as #585, and
  the fifteen agent-tab files landed as #588 on a sibling branch carrying the
  suffix `-b`, which this plan never named. Both PRs are recorded on this line
  because the delivery gate reads branch lines, and work behind an unnamed
  branch is work it cannot check.

  Migrated the two files whose subject is the board PAYLOAD — `branch-served` and
  `plan-source`, 11 tests, 4.95 s → 1.85 s. Override ratio **4.1 %** (1.82 of 44
  payload fields, weighted over 11 tests), well inside the plan's 50 % gate.

  `tiny-garden` and `story-overlay` did NOT migrate, and the gap is in the
  catalogue rather than in them: `a-board-of-plans` carries `sprints: []` and
  `stories: []` while naming a sprint and a story on its cards, so the sprint
  filter has nothing to filter and the story overlay nothing to open. Both also
  read the `/plan/<file>` and `/story/<slug>` DOCUMENT routes, which the mock
  does not serve and cannot without reading a fixture repo — `renderPlanPage`
  takes a `repoRoot`. A populated `sprints`/`stories` scenario and a decision
  about document routes are Naming-slice work.

### Moving the agents

- `infra/the-agents-tab-tests-serve-their-own-state` — the fleet-side files, excluding `agents-tab` itself. `/api/fleet` carries rows, waves, agents and summary, so this is where the scenarios are exercised hardest. → #591

### The big one

- `infra/the-agents-tab-test-serves-its-own-state` — `agents-tab.browser.test.ts` alone, 117 tests, on a catalogue proven by everything above. → #592

### The last two

- `infra/the-last-two-browser-tests-serve-their-own-state` — teach the mock to serve a document, and migrate `story-overlay`. → #593
- `infra/the-last-file-serves-its-own-state` — `tiny-garden`, twelve of thirteen tests, plus the entitlement the thirteenth declares. → #594

  **A wave this plan did not name, added while running.** The Survey judged both
  files un-migratable and *"Moving the plans"* above records the reason: they
  read the `/plan/<file>` and `/story/<slug>` DOCUMENT routes, which *"the mock
  does not serve and cannot without reading a fixture repo — `renderPlanPage`
  takes a `repoRoot`."*

  That reasoning was wrong, and the correction is the wave. A document is a
  **fetch**: `DocModal` requests `<href>?embed=1` and injects the response as
  the iframe's `srcDoc`, so the mock needed an answer rather than a repository.
  `serveDoc` supplies it, and its 404 is as much of the feature as its 200 — a
  plan whose story nobody has written is a state `story-overlay` asserts on, and
  a mock inventing an empty document would make that state unstatable.

  `tiny-garden` then split rather than migrating whole, and the split is the
  finding: its subject is an estate, which was true of exactly ONE of its
  thirteen tests. `a-whole-small-estate` states the eight cards and four sprints
  the other twelve count, because a count is a fact about a population and a
  population read from a directory is one nobody stated. The thirteenth opens
  the plan page in a new tab and asserts the `plan-back` titlebar
  `renderPlanPage` adds only when `embed` is false — that flag IS the assertion,
  so a mock serving a handed-over document can fail neither direction.

  Both branches are recorded here because the delivery gate reads branch lines,
  and work behind an unnamed branch is work it cannot check — the same reason
  *"Moving the plans"* records its own split.

### Closing

- `infra/every-browser-test-serves-its-own-state` — extend the gate from *"a fully-stubbed file must not start a board"* to *"only the classified exceptions may"*, with the exception list derived from the Sorting slice rather than hand-maintained. → #595

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

## Survey

*Slice 1, `infra/the-browser-tests-say-which-need-a-server`, 2026-08-31.
Read-only: no test file was modified.*

### The population is 32, not 33 — and three of them are not browser tests

The plan's 33 counted `mock-board.browser.test.ts`, which mentions
`startServer` only **inside a string it greps for** (`must not start a real
board`). It starts nothing; it is the catalogue's own test. Removing it leaves
**32 files and 372 `it(`**.

Three of the 32 launch no Chromium either — `tiny-garden.data`, `.plan` and
`.story` drive `GET /api/board`, `/plan/<file>` and `/story/<slug>` against the
spawned artifact with `fetch`. They are **server-route tests that happen to sit
in the browser directory**, and the catalogue has nothing to offer them: their
subject *is* the real server's routing and allowlist.

So the migratable browser population is **29 files, 350 tests**.

### The finding that resizes the plan: most of these already serve their state

`/api/fleet` is stubbed in **20 of the 29**. Seventeen of those never read
`/api/board` at all — the fixture path is passed to `startServer` as a working
directory and the served payload is never looked at. They spawn a board to be
**a static file server for the built bundle**, nothing more.

That is not the picture the Motivation drew, and it changes what the later
slices cost. The work is not *"invent a fleet payload for 29 files"* — most
already have one. It is *"stop starting a server to serve `index.html`"*, plus
a genuine board-payload migration for the six files that read `/api/board`.

**The write-route hypothesis is mostly false, and measurably so.** Of the six
files the brief flagged as likely *must stay real*, five already intercept
every write endpoint they touch with `page.route`:

| file | write endpoints | intercepted? |
|---|---|---|
| `button-claims` | `/api/dispatch`, `/api/dispatch-log` | both |
| `double-click` | `/api/approve`, `/api/dispatch` | both |
| `fleet-settings` | `/api/dispatch`, `/api/fleet-controls` | both |
| `spinner` | `/api/approve`, `/api/dispatch` | both |
| `start-work-refusal` | `/api/dispatch` | yes |
| **`approve`** | `/api/approve` | **no — reaches the script** |

`approve.browser.test.ts` is the only file in the suite where a write leaves the
browser and lands in `Approve command`. It copies the fixture to a temp
directory first, precisely so the real config is read, and asserts the script's
own failure sentence on the card. It is the one unambiguous *must stay real*.

### The table

**Verdicts.** `catalogue candidate` — its board state can be named.
`must stay real` — with the reason. `interception over baseline` — a board
that cannot answer, layered over a served state.

`route f` / `route b` count `page.route` handlers for `/api/fleet` and
`/api/board`. `ms` is summed in-file test time from the run below.

#### Catalogue candidates — fleet already stubbed, board never read (17 files, 159 tests)

These need **no new payload at all**. Each already builds the fleet it asserts
against; the migration is swapping `startServer(FIXTURE)` for `openCatalogue()`
so the bundle is served without a board process.

| file | its | route f | ms |
|---|---|---|---|
| `activity-mark.browser.test.ts` | 24 | 3 | 7901 |
| `group-activity.browser.test.ts` | 15 | 2 | 4541 |
| `row-withholds.browser.test.ts` | 16 | 1 | 5734 |
| `stuck-rows.browser.test.ts` | 15 | 1 | 5425 |
| `not-started-plans.browser.test.ts` | 14 | 1 | 4635 |
| `unplanned-issues.browser.test.ts` | 11 | 1 | 3603 |
| `one-grid.browser.test.ts` | 8 | 1 | 2650 |
| `folded-plan-pr-fold.browser.test.ts` | 7 | 1 | 2358 |
| `working-shows-every-agent.browser.test.ts` | 5 | 1 | 1646 |
| `split-plan-counts-elsewhere.browser.test.ts` | 4 | 2 | 1550 |
| `stuck-row-alignment.browser.test.ts` | 4 | 1 | 1330 |
| `wave-name-in-cell.browser.test.ts` | 3 | 1 | 962 |
| `wave-head-says-its-verdict.browser.test.ts` | 2 | 1 | 657 |
| `wave-in-working.browser.test.ts` | 2 | 1 | 614 |
| `wave-leaves-the-kind-alone.browser.test.ts` | 6 | 0 | 5806 |
| `command-copy.browser.test.ts` | 8 | 2 | 1812 |
| `worker-log.browser.test.ts` | 15 | 4 | 8949 |

`wave-leaves-the-kind-alone` routes no `/api/fleet` and reads the real pulse of
the fixture repo — the one file in this group needing a named state rather than
a lift-and-shift. `command-copy` and `worker-log` are the two hand-spawners
(`spawn('node', [ARTIFACT])`); they also stub `/api/agent-panel`, so the
catalogue needs that third endpoint or they need an override hook for it.

#### Catalogue candidates — write routes already intercepted (5 files, 30 tests)

The write is a `page.route` assertion about **what the browser sent**, not about
what a script did. They need a board state and a way to observe a POST.

| file | its | ms | needs |
|---|---|---|---|
| `spinner.browser.test.ts` | 10 | 6665 | a Draft card + a startable row; 500-response case |
| `double-click.browser.test.ts` | 5 | 4515 | a Draft card + a startable row |
| `button-claims.browser.test.ts` | 4 | 18466 | a startable row; `/api/dispatch-log` |
| `start-work-refusal.browser.test.ts` | 4 | 2541 | a startable row and a refused one |
| `fleet-settings.browser.test.ts` | 7 | 2295 | `/api/fleet-controls` state |

**Three endpoints the catalogue does not serve yet** surface here and must be
part of the Naming slice's brief: `/api/dispatch-log`, `/api/fleet-controls`,
`/api/agent-panel`. A catalogue that serves only `/api/board` and `/api/fleet`
cannot take these five files or the two hand-spawners above.

#### Catalogue candidates — board payload, needs a card scenario (4 files, 36 tests)

These read `/api/board` from the real fixture and assert on tiny-garden's card
titles. Migrating them means naming board states, which the catalogue can
already express (`board()`, `card()`, `column()`).

| file | its | ms | state it needs |
|---|---|---|---|
| `tiny-garden.browser.test.ts` | 13 | 10243 | a full multi-phase board; a mobile viewport; sprint filter |
| `story-overlay.browser.test.ts` | 12 | 9301 | a card with a story; `/story/<slug>` served |
| `plan-source.browser.test.ts` | 9 | 841 | cards with `source` markers, ref-unseen |
| `branch-served.browser.test.ts` | 2 | 205 | a `server.branch` value in the payload |

`story-overlay` needs `/story/<slug>` to answer, which is a **document route**
rather than a payload — the same third-endpoint problem as above.

`tiny-garden.browser.test.ts` is the judgement the plan flagged. **Verdict:
catalogue candidate.** Its assertions are about layout (no horizontal scroll at
phone width) and the sprint filter — neither needs a real estate, both need a
board with enough cards. The fixture repo stays for the three route tests and
for `approve`, so nothing is deleted by moving this file.

#### Must stay real (2 files, 14 tests)

| file | its | ms | why |
|---|---|---|---|
| `approve.browser.test.ts` | 12 | 8831 | **a write reaches a script.** The only one. Runs the configured `Approve command` against a detached copy of the fixture and asserts the script's own sentence. A mock accepting the POST would assert nothing. |
| `dead-fetch.browser.test.ts` | 2 | 30345 | **process behaviour.** Reproduces a socket accepted and then abandoned — the failure `route.abort()` cannot produce, as its own docstring records: *"a test built on it passes against the bug."* It needs a real transport that can be left hanging. |

`dead-fetch` costs 30.3 s for two tests — the second-worst ratio in the suite,
and structural: it waits out a hang deliberately. Worth stating so a later
slice does not read it as low-hanging fruit.

#### Not browser tests — out of this plan's scope (3 files, 22 tests)

| file | its | ms | subject |
|---|---|---|---|
| `tiny-garden.data.test.ts` | 5 | 1517 | `/api/board` payload, real helpers |
| `tiny-garden.plan.test.ts` | 8 | 459 | `/plan/<file>` render + traversal guard |
| `tiny-garden.story.test.ts` | 9 | 709 | `/story/<slug>` resolver + allowlist |

They spawn the artifact and speak HTTP. Their subject is the server, so
*"serve your own state"* is not a thing they could do. **Recommendation: the
Closing slice's gate must not count them**, and the cheapest way to keep that
honest is to exclude on *launches Chromium*, not on the file name.

#### The big one

| file | its | route f | route b | ms |
|---|---|---|---|---|
| `agents-tab.browser.test.ts` | 111 | 14 | 1 (`abort`) | **127183** |

**33 % of the serial project's wall clock in one file**, and it already stubs
`/api/fleet` in every path. See the next section.

#### Interception over baseline — already migrated, listed as the pattern

`unreachable-overlay.browser.test.ts` (25 tests, 63.3 s) starts no board and is
the worked example: `abort`, HTTP 500 and malformed JSON layered over a served
scenario. It is the reference for `agents-tab`'s abort paths.

At 63.3 s for 25 tests it is also the **second most expensive file in the
suite** — a migrated file, so the cost is not the server. Whatever it waits for
survived the migration, and the final slice's delta should not be read without
noticing that.

### What `agents-tab.browser.test.ts` needs from the catalogue

Read in full, 4146 lines. It stubs `/api/fleet` in all 14 routes and aborts
`/api/board` once, deliberately. **The obstacle is not the payload — it is that
the file carries its own private `row()`, `agent()` and `fleet()` builders**
(lines 24–170) that have drifted from `test/catalogue/build.ts`. Migrating it
means reconciling two builders, not writing a fixture.

**Its default `fleet()` is a ten-row estate**, and every row is there to hold a
distinguishable case. This list is the catalogue's requirement:

| row | group | carries |
|---|---|---|
| `feature/beans-a`, `feature/beans-b` | working | two plans in one group → sub-headings; ages 200 / 10 to fix order |
| `feature/toms-a` | working | the second plan |
| `feature/reviewed` | waiting-on-you | a PR as **fields** (`number`, `url`, `draft`, `state: 'green'`), never prose |
| `feature/untaken` | not-started | `state: 'open'`, `waitingOn: 'click'`, `ELIGIBLE_NOTE`, `waitingDays: 22`, `startability: 'start-work'` — the only startable row |
| `feature/blocked` | not-started | `waitingOn: 'time'`, `blockedBy: 'Truth'`, `startability: null` |
| `feature/shelved` | not-started | `state: 'deferred'` with recent commits — phase fell back but the badge says why |
| `feature/undated` | not-started | `waitingDays: null` — a plan predating `Approved:` |
| `feature/landed` | done | `state: 'merged'`, `branchUrl: ''` — no branch link |
| `feature/ghost` | quiet | `planFile` naming a plan with **no board card** |
| `feature/ghost-ready` | not-started | startable **and** cardless → no button rather than a broken one |

Plus the envelope: `ready`, `error`, `ageSeconds`, `prAgeSeconds`,
`prNextInSeconds`, `scanNextInSeconds`, `prError`, and a `summary` of
`{plans, waves, branches, claimed, eligible, blocked, deferred}`.

And a derivation the catalogue must reproduce: **WORKING renders one row per
registry `agent`, joined to a branch row by `branch`.** `agents-tab` derives
its `agents` array from the final rows, so a test that reroutes a working row
gets exactly the agents its rows imply. A catalogue that takes `rows` and
`agents` independently will silently render an empty WORKING section — the
`waves`-shaped failure the plan's Notes warn about, one field along.

**Six behaviours beyond a static payload**, each currently a local helper:

1. `openAgents(payload)` — serve a fleet and open `?tab=agents`.
2. `openAgentsReducedMotion(payload)` — a **context** with `reducedMotion: 'reduce'`, set before first paint.
3. `openAgentsWithFailSwitch(payload)` — a mutable flag flipping fulfil → `abort('connectionrefused')`, installed once so a poll in flight cannot slip through an unrouted window.
4. `openAgentsPushable(initial)` — swap the payload mid-session and **wait for the served count to advance**, not for a duration.
5. `/api/board` aborted while the fleet answers — *"no action before the board has said whether it can dispatch"*.
6. A **shared browser context across reloads**, for `localStorage` fold persistence.

Items 3 and 4 are the ones a static catalogue cannot express. The catalogue
needs to hand back a **mutable served state**, not just a payload — and that is
a design decision for the Naming slice, taken now rather than discovered under
111 tests.

**Answering the plan's first Open Question early:** these ten rows are one
scenario, not ten. The right shape is a small number of rich named estates plus
per-test overrides, which is what `agents-tab` already does with a single
default and `fleet({ rows: … })` on top.

### The baseline

Measured 2026-08-31, this worktree, on the artifact built from this branch.

**Machine.** Apple M4, 10 cores, 32 GB, macOS `Darwin 25.5.0` arm64, Node
v24.20.0, pnpm 10.27.0.

**Load.** Not idle — sibling agents were running. `pnpm run test:board`:
load average **2.41** before, **3.17** after (1-minute). Serial project alone:
**3.15** before, **4.14** after. Treat the numbers as conditional on that, which
is the reason the load is recorded rather than the machine alone.

| run | wall clock | contents |
|---|---|---|
| `pnpm run test:board` | **456 s** | build + 233 node:test + 2480 vitest, exit 0 |
| ├ node:test (`pnpm --filter … test`) | 18.1 s | 82 suites, 233 pass |
| └ `vitest run` (both projects) | 433.8 s | 132 files, 2477 pass / 3 skip |
| `vitest run --project serial` | **383 s** | 48 files, 486 pass |

**The number the final slice compares against is 456 s**, with **383 s** the
part this plan can move. The bound is 1200 s (`scripts/bounded.sh`); the run
finished at 38 % of it, so this is a complete run and not a truncated one.

**486 runtime tests against the gate's `EXPECTED_TESTS = 479`.** Not a
discrepancy: the gate counts `it(` statically and seven tests come from loops.
A slice that changes a loop bound moves one number and not the other — worth
knowing before the tripwire fires and is misread.

**Where the time is.** Four files are 62 % of the serial project:

| file | tests | s | share |
|---|---|---|---|
| `agents-tab.browser.test.ts` | 117 | 127.2 | 33 % |
| `unreachable-overlay.browser.test.ts` | 25 | 63.3 | 17 % |
| `dead-fetch.browser.test.ts` | 3 | 30.3 | 8 % |
| `button-claims.browser.test.ts` | 4 | 18.5 | 5 % |

Two of those four (`unreachable-overlay`, `dead-fetch`) will not move: one is
already migrated, the other waits on purpose. **So roughly 90 s of the 383 s is
structurally unavailable to this plan**, and the honest target is the remaining
~290 s. Stating it here so the final slice's delta is read against the right
denominator.

### Handed on, not settled

**`tiny-garden`'s consumers, per the plan's second Open Question.** 36 files
reference it; the fixture directory's own contents excluded, the readers are:

- **29 browser tests** — of which 25 are catalogue candidates by this table.
- **3 server-route tests** (`tiny-garden.{data,plan,story}`) — the fixture is
  their subject.
- **1 node:test** — `test/discovery.test.mjs`.
- **1 config comment** — `vitest.config.ts`.
- **1 production script** — `skills/plot/scripts/plot-reap.sh:334`, which
  excuses `tiny-garden/.plot/state` from the uncommitted-changes guard *because
  every board suite rewrites it*.

**So the fixture survives this plan regardless**, and that last entry is the
finding worth handing on: a **shell script in production** depends on the
fixture being churned by tests. If the migration stops the churn, that
exclusion becomes dead code — harmless, but it should be retired by whoever
notices, and it is noticed here.

**Two things the Deciding slice now has evidence for.**

The declare-then-verify predicate needs a **third** entitlement beyond *write
route* and *process behaviour*: `dead-fetch` asserts neither — it needs a real
transport it can abandon. And *"exercises a write route"* must mean **an
un-intercepted one**, or five files that `page.route` every write would each
qualify for an exception they do not need.

The count-assertion question has a concrete answer: the gate counts `it(` in
`test/integration/`, and nothing in this table proposes moving a file out of it.
The risk is the reverse — the three route tests and the parallel project. Gating
on *launches Chromium* rather than on the directory keeps the population right
whichever way files move.

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
