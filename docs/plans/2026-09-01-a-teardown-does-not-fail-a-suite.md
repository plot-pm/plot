# A teardown does not fail a suite

> `test:board` fails on a first run and passes on a second, because 81 raw
> `fs.rmSync` teardowns race a doomed child process. The retrying `rmTree` that
> absorbs exactly this was written for exactly this and is called once.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A fixture's teardown no longer fails the suite it was cleaning up after: the
  bounded retry that already absorbs a transient `ENOTEMPTY` is used by every
  scratch-directory cleanup rather than by one.

Board impact: tests only. No production source, no plan format, no helper
scripts.

## Motivation

**Measured 2026-08-31, verifying one branch:** `pnpm run test:board` failed on
the first run and passed on the second, **three times**, and the failure moved:

| run | test that failed | site |
|---|---|---|
| 1 | `port.test.mjs` — the BOUND port reaches the same-origin check | `helpers.mjs:246` |
| 2 | `write-gate.test.mjs` — the opt-in is deliberate and exact | `helpers.mjs:246` |
| 3 | `port.test.mjs` again | `helpers.mjs:246` |

Always the same error, always in an `after()` hook, never in an assertion:

```
Error: ENOTEMPTY, Directory not empty: /var/folders/…/T/plot-board-stub-8mC1bY
    at Object.rmSync (node:fs:1283:18)
    at Object.cleanup (packages/board/test/helpers.mjs:246:23)
```

### The diagnosis is already written down, one file away

`helpers.mjs:455` explains the mechanism in full, for the `rmTree` it introduces:

> a stub server's child is outside the scope of the SIGTERM sent to its parent,
> so it can still create `.git/index.lock` or an object file a few milliseconds
> after the server is gone. `rmSync` walks a directory, deletes what it saw,
> then `rmdir`s the parent; a file appearing between those two steps fails the
> `rmdir` with ENOTEMPTY.

And it names the trap that makes `force: true` look sufficient:

> `force: true` does not cover this. It suppresses "no such file" — the absence
> of something expected — while this is the presence of something unexpected,
> the opposite failure.

**So this plan invents nothing.** The fix exists, is tested
(`git-retry.test.mjs:151`, *"absorbs a transient ENOTEMPTY and still deletes the
tree"*), and is documented as *"a drop-in for the `fs.rmSync` calls it
replaces"*.

### It replaced one of them

| | count |
|---|---|
| `rmTree(` calls in the board suite | **1** |
| raw `fs.rmSync(…, { recursive: true })` | **81** |

`helpers.mjs:246` — the line all three failures ran through — is a raw
`fs.rmSync`, eleven lines above a helper written to replace it.

### Why a flaky teardown costs more than a flaky test

**It fails the run, not the case.** `node --test` reports an `after()` throw as
the test failing, so the output blames `the BOUND port reaches the same-origin
check` — a test that passed. Three separate times tonight, a verification run
had to be repeated to find out whether a branch was green, and each `test:board`
is ~456 s.

**It teaches the wrong reflex.** The correct response tonight was *"re-run it"*,
and it was correct three times. A suite that is right to ignore once is a suite
that gets ignored when it is right — and this repo has already measured that
failure from the other end: `a-hung-launcher-is-not-a-live-one` exists because
orphaned servers were read as a hung test run.

**Concurrency makes it likelier, and the fleet is concurrent.** All three
failures happened while a dispatched worker ran `test:board` in another
worktree. `--test-concurrency=4` plus a second suite is exactly the contention
the docblock describes.

## Design

### Use the helper that exists, everywhere

Not a new mechanism — `rmTree` already bounds its retries (10 × 25 ms), is
synchronous so it drops into non-async `after()` hooks, and rethrows anything
outside `ENOTEMPTY`/`EBUSY`/`EPERM` on the first attempt so a genuinely broken
fixture still fails fast.

### The unit is a teardown of a directory a server wrote in

**Not every `fs.rmSync` in the suite.** The 81 include cases with no server and
no child — a `mkdtemp` a unit test wrote a JSON file into cannot race anything,
and converting it adds a retry that can never fire. The population is a
teardown that removes a directory some spawned process had open, which is what
makes contention possible.

Deciding which is the first slice's work, from the same reading the count came
from, rather than a blanket substitution.

### Why not make `cleanup()` the only door

Tempting: `helpers.mjs:246` is one line, and fixing it alone would have
prevented all three failures tonight. It is the first slice for that reason.

It is not the whole plan, because `port.test.mjs` and `lifetime.test.mjs` also
call `fs.rmSync` on their own `tmp` **beside** `stub.cleanup()` — four sites in
`port.test.mjs` alone. Those tear down a directory the same doomed child could
be writing to, and they would keep failing after the helper was fixed.

### Open Questions

- [ ] Is `retries = 10, delayMs = 25` right for a loaded machine? It was sized
      against CI. All three failures here happened under a concurrent worker,
      which is a heavier contention than CI's, and a 250 ms ceiling may be short.
      Measure before changing it — a retry budget raised on a guess hides the
      next real failure for a quarter second longer and proves nothing.
- [ ] Should a `PLOT-*` guard fail the build when a new raw recursive `rmSync`
      appears in a teardown? A gate is the repo's stated preference over a rule,
      but the population above is *"teardowns that race a child"*, which no grep
      can name precisely. A gate that fires on all 81 would be turned off.

## Branches

### Closing the door everyone walks through

- `bug/the-stub-fixture-retries-its-teardown` — `helpers.mjs:246` calls `rmTree`. One line, plus the test that proves the fixture survives a directory that regrows once. This alone would have prevented all three failures measured tonight, so it ships first and separately.

### The teardowns beside it

- `bug/a-server-test-tears-down-with-the-retry` — the sites that remove a directory a spawned server wrote in: `port.test.mjs` (4), `lifetime.test.mjs` (4), `agent-panel.test.mjs`, `worker-log.test.mjs`, and whatever the reading adds. Each converted to `rmTree`; the ones with no child process are listed and left alone, with the list in the PR so the exclusion is reviewable.

### Knowing whether it worked

- `bug/the-board-suite-runs-twice-green` — run `test:board` under deliberate contention (a second suite in another worktree, the condition all three failures shared) and record first-run outcomes before and after. The plan's own claim is *"a first run passes"*, and nothing above proves it.

## Done when

- **`test:board` passes on a FIRST run, twice in a row, under deliberate
  contention** — a second suite running in another worktree. Measured and stated
  in the changeset, because "passes on a re-run" is the symptom, not the fix.
- No teardown of a directory a spawned process wrote in calls `fs.rmSync`
  directly; the sites deliberately left alone are named in a PR.
- `git-retry.test.mjs`'s absorption test still passes, and the fixture gains one
  proving `cleanup()` itself survives a regrowing directory.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset.

## Notes

**This is a plan about a helper being unused, not about a bug being unknown.**
The mechanism, the reason `force: true` does not cover it, and the bounded-retry
fix were all written on 2026-08-31 in `helpers.mjs:455-476`, with a test. What
did not happen is the substitution the docblock describes itself as: *"a drop-in
for the `fs.rmSync` calls it replaces."* One call site out of 82.

**The measurement that matters is the first run.** A suite that passes on retry
is indistinguishable from a suite that passes, right up to the moment somebody
believes a red result. Tonight the red results were all spurious and all
correctly ignored — which is the habit worth removing, not the failures.
