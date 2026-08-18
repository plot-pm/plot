# The board test does not race its own server

> `discovery.test.mjs` starts a board server against a fixture repo and then runs `git` in that same repo. The server's scan and the test's commands contend for `index.lock`, and CI fails on a change that touched only markdown.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Delivered:** 2026-08-18, jwloka, PR #214
- **Started:** 2026-08-18, Jan Wloka, `bug/the-board-test-does-not-race-its-own-server`

## Changelog

- The board's discovery tests no longer fail intermittently when the server under test scans the fixture repo while the test is writing to it.

## Motivation

CI failed on `bug/bb-state-vocabulary` at commit `cdd44ba`, which added **one
87-line markdown file** and nothing else. The previous commit — the entire
implementation plus 135 lines of new tests — passed.

```
not ok 6 - picks up a plan pushed to a NEW branch after the first read
  duration_ms: 37.259
  Command failed: git checkout main
  fatal: Unable to create '/tmp/plot-board-discovery-xd8vfy/work/.git/index.lock':
         File exists.
  Another git process seems to be running in this repository
```

37 milliseconds. A markdown file cannot cause that.

### The race

The fixture starts a real board server against the repo the test then mutates:

```
155:  server = await startServer(fixture.repo);
```

That server polls on `REFRESH_MS` (5 s), and each poll runs `plot-fleet-scan.sh`
against `fixture.repo`. The test meanwhile runs:

```
g('checkout', '-b', 'idea/arrived-late');
g('add', '-A'); g('commit', ...); g('push', ...);
g('checkout', 'main');
```

Both hold `.git/index.lock`. The test's helper has no retry:

```
61:  const git = (cwd) => (...args) =>
        execFileSync('git', args, { cwd, encoding: 'utf8', ... });
```

So whichever loses the race throws, and the test fails with an error that names
git rather than the board.

### Why it appeared today

Reproduced locally 2026-08-18 while four agent workers were running git
operations on the same machine: the suite failed with a *different* assertion
(`actual: 2, expected: 1`). Re-run in isolation minutes later on the same
commit: **11/11 pass, 0 failures**.

Load is the variable. The suite has been green for weeks because nothing else
was competing; a busy machine — which is precisely what a fleet run produces —
makes the window wide enough to hit. It will recur, and it will keep looking
like whatever change happens to be in flight.

### The cost is misattribution, not flakiness

A flaky test that announces itself is an annoyance. This one blames the commit
under test: a contributor sees CI red on their branch, and the failure names a
board discovery test they did not touch. During this session it produced two
wrong diagnoses before the log was read carefully.

Notably, `plot-fleet-scan.sh` already treats this exact condition as
information rather than failure — line 265 observes `.git/index.lock` directly
to report *an agent is writing HERE, RIGHT NOW*. The system understands lock
contention in production and not in its own test harness.

## Design

### Approach

**Retry the test's git calls on lock contention.** The fixture's `git` helper
gains a bounded retry: on a failure whose stderr names `index.lock`, wait
briefly and try again, a few times, then fail for real. Contention is transient
by definition — the holder finishes in milliseconds — so a short retry converts
a spurious failure into a slightly slower test.

This is the smallest fix and it matches how the production code treats the same
signal: a lock is a state to handle, not an error to propagate.

**Fail loudly when it is not contention.** The retry must key on the lock
message specifically. A blanket retry would paper over real git errors and turn
a deterministic failure into a slow flaky one — the opposite of the goal.

### Alternatives considered

**Do not start the server until the fixture is final.** Several tests
deliberately mutate the repo *after* the first read — that is the behaviour
under test ("picks up a plan pushed to a NEW branch after the first read"), so
the concurrency is the point and cannot be removed.

**Give the server its own clone.** Isolates the two completely, but the test
then no longer proves the server sees changes in the repo it is watching, which
is the whole assertion.

**Raise `REFRESH_MS` during tests.** Narrows the window without closing it, and
makes the tests slower to observe what they are asserting. A narrower race is
still a race.

### Open Points

- [x] Do the other board suites share the fixture pattern? **Yes — measured
      2026-08-18.** `startServer` is called by six files: `bridge`, `approve`,
      `board`, `claimed`, `dispatch`, and `discovery`, via the shared
      `test/helpers.mjs`. `discovery.test.mjs` is where the failure was caught,
      not where the exposure ends.
- [x] Should the retry live in the test helper or a shared fixture module?
      **The shared helper**, `test/helpers.mjs`, which all six already import.
      One implementation, and a suite added tomorrow inherits it — the
      difference between fixing a bug and fixing a class of bug. Fixing only
      `discovery.test.mjs` would leave five suites failing the same way on a
      busy machine, one at a time, each looking like a fresh mystery.
- [ ] Is there a case for `plot-fleet-scan.sh` itself to retry on lock, rather
      than reporting? It currently reports deliberately, and that is right for
      the fleet view — but the board calls it on a 5 s timer and may prefer a
      brief retry to a reported blip.

## Branches

- `bug/the-board-test-does-not-race-its-own-server` — bounded, lock-specific retry in the **shared** git helper in `packages/board/test/helpers.mjs`, so all six suites that call `startServer` inherit it (`bridge`, `approve`, `board`, `claimed`, `dispatch`, `discovery`). Keyed on `index.lock` in stderr specifically: a blanket retry would paper over real git errors and turn a deterministic failure into a slow flaky one. PR #214.

  Test: the retry path must be exercised deliberately — hold a lock, assert the helper still succeeds — rather than left to chance. A test that merely runs the suite proves nothing, since the race is load-dependent and the suite passes in isolation.

## Notes

Found while shepherding PR #210 through CI during a four-worker fleet run. The
evidence is in run `32122209894`: the failing commit added only
`.plot/briefs/bb-state-vocabulary.md`, and the run before it — carrying the
whole implementation — was green.
