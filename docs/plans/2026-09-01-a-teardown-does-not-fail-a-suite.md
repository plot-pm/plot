# A teardown does not fail a suite

> `test:board` fails on a first run and passes on a second, because 81 raw
> `fs.rmSync` teardowns race a doomed child process. The retrying `rmTree` that
> absorbs exactly this was written for exactly this and is called once.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Started:** 2026-09-01, Jan Wloka, `bug/a-test-teardown-does-not-call-rmsync`

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

### The control: serial passes, parallel fails

**Measured 2026-09-01 on the same tree, same commit:**

| run | result |
|---|---|
| `node --test --test-concurrency=1 test/*.test.mjs` | **exit 0** |
| `node --test --test-concurrency=4` (what `test:board` runs) | **failed 5 of 5 attempts** |

That is the cleanest available proof that the tests themselves are sound and
concurrency is the whole trigger. It also rules out the tempting alternative
reading — that the fixtures collide on a shared temp root — because a shared
root would collide serially too.

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

### Every test teardown, because the distinction costs more than it saves

The tempting scope is *"only the teardowns that can race a child"*. It is
rejected, for two reasons that only became clear once the numbers were counted.

**A retry that never fires is free.** `rmTree`'s first attempt IS
`fs.rmSync(target, { recursive: true, force: true })` — the identical call, and
on a clean removal it returns from that attempt. There is no behaviour to
change, no delay to pay, and nothing to weigh: a site that cannot race is
converted at zero cost.

**And the precise population is not nameable.** *"Removes a directory a spawned
process wrote in"* is a judgement about what a fixture did, which no grep can
decide — the plan would ask a reviewer to re-make that judgement every time a
teardown is added, which is a rule, and this repo's own guidance says a rule is
what an author can answer *"did I do this?"* about without doing it.

**So the rule is mechanical: a test teardown does not call `fs.rmSync`
directly.** Gateable by grep, decidable without judgement, and it makes the
second Open Question answerable rather than perpetual.

**Measured 2026-09-01 — the population, exactly:**

| | count |
|---|---|
| `fs.rmSync(…, { recursive })` under `packages/board/test/` | **80** |
| of those, already inside `rmTree` itself | 1 (`helpers.mjs:481`, the implementation) |
| `rmTree(` call sites | **1** |

### Production is NOT in scope, and one production site looks like the same bug

Three `fs.rmSync` calls live in `packages/board/src/`:

    server/idea.ts:691    removes an idea worktree
    server/board.ts:1579  removes a stage dir
    server/board.ts:1864  removes a stage dir

`board.ts`'s two remove a directory a **git** process wrote in, which is the
same shape as the failure this plan is about — a doomed child writing after its
parent was signalled. They are excluded anyway: this plan is about a teardown
failing a test suite, and a production `rmSync` throwing is a different subject
with a different blast radius. **Recorded so it is not mistaken for coverage** —
whether the board itself can fail this way is worth its own reading.

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
- [x] Should a guard fail the build when a new raw recursive `rmSync` appears in
      a test teardown? **Yes, and the blanket scope is what makes it possible.**
      The population is now *"a file under `packages/board/test/` calling
      `fs.rmSync` with `recursive`"* — a grep, not a judgement — with a single
      allowance for `rmTree`'s own implementation. A gate scoped to *"teardowns
      that race a child"* would have needed a reviewer's opinion per site and
      would have been turned off; this one cannot be argued with.

## Branches

### Closing the door everyone walks through

- `bug/the-stub-fixture-retries-its-teardown` — `helpers.mjs:246` calls `rmTree`. One line, plus the test that proves the fixture survives a directory that regrows once. This alone would have prevented all three failures measured tonight, so it ships first and separately.

### Every teardown, and the gate that keeps it that way

- `bug/a-test-teardown-does-not-call-rmsync` — all 79 remaining sites under `packages/board/test/` converted to `rmTree`, plus a gate refusing a new raw recursive `fs.rmSync` in that directory (allowing only `rmTree`'s own implementation). Mechanical rather than judged: `rmTree`'s first attempt is the identical call, so a site that cannot race is converted at no cost, and the diff is reviewable as a substitution rather than as 79 decisions. → #616

### Knowing whether it worked

- `bug/the-board-suite-runs-twice-green` — run `test:board` under deliberate contention (a second suite in another worktree, the condition all three failures shared) and record first-run outcomes before and after. The plan's own claim is *"a first run passes"*, and nothing above proves it.

## Done when

- **`test:board` passes on a FIRST run, twice in a row, under deliberate
  contention** — a second suite running in another worktree. Measured and stated
  in the changeset, because "passes on a re-run" is the symptom, not the fix.
- **No file under `packages/board/test/` calls `fs.rmSync` with `recursive`**,
  `rmTree`'s own implementation excepted, and a gate fails the build when one
  reappears. Asserted by the gate, not by review.
- The three production sites are untouched, and the reading of whether
  `board.ts`'s stage-dir removals can fail the same way is recorded somewhere a
  plan can pick it up.
- `git-retry.test.mjs`'s absorption test still passes, and the fixture gains one
  proving `cleanup()` itself survives a regrowing directory.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset.

## The corpus tier has the same shape of problem, and it is not this plan's

**Measured 2026-09-01.** `refs.corpus.test.ts` compares the adapter's pulse
against `plot-fleet-scan.sh` over the LIVE estate, and both readings fetch. It
pins `origin/HEAD` for exactly this reason, and the pin covers the default
branch only:

    branch pushed          07:03:19 UTC
    582's corpus ran       07:03:05 → 07:03:47 UTC

A push landed **14 seconds into the run**, so `changed_paths` for
`infra/only-an-adapter-reaches-a-script` disagreed by one file — the adapter
read the branch before the push, the scan after. The same tree passed 13/13
locally minutes later.

The file's own docblock already records two earlier instances (`conflicts` on
2026-08-31, `read_ref` on 2026-09-01) and the fix that did not work
(`--no-fetch`, which gave the two readings different worlds rather than one).
The pin freezes `origin/main`; **a feature ref the comparison touches is not
frozen at all**, and a fleet pushing continuously will keep splitting it.

**Not fixed here, and not by excluding the field.** `changed_paths` is a real
reading and dropping it weakens the tier. Pinning every ref the comparison
resolves — or resolving the branch list once and pinning each — is a design
question with the same shape as this plan's subject: a green suite that a
concurrent writer can turn red. It belongs in its own plan, and this section
exists so the measurement is not lost.

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
