# Brief: bug/the-board-test-does-not-race-its-own-server

Implement `docs/plans/2026-08-18-the-board-test-does-not-race-its-own-server.md`.

Read it first. The diagnosis is measured and the scope was settled during
interrogation: **do not re-derive it, do not widen it.**

## The bug

CI failed on a commit that added **one 87-line markdown file and nothing else**.
The commit before it — a whole implementation plus 135 lines of tests — passed.

```
not ok 6 - picks up a plan pushed to a NEW branch after the first read
  duration_ms: 37.259
  Command failed: git checkout main
  fatal: Unable to create '/tmp/plot-board-discovery-xd8vfy/work/.git/index.lock':
         File exists.
```

37 milliseconds. A markdown file cannot cause that.

The fixture starts a **real board server against the repo the test then
mutates** (`discovery.test.mjs:155`). The server polls every 5 s, each poll
scanning that repo; the test runs `git checkout`, `commit`, `push` in it. Both
want `.git/index.lock`, and the test's git helper has no retry.

## Six suites, not one

`startServer` is called by **`bridge`, `approve`, `board`, `claimed`,
`dispatch`, and `discovery`** — all through the shared
`packages/board/test/helpers.mjs`.

So the retry goes **in the shared helper**, not in `discovery.test.mjs`. One
implementation; a suite added tomorrow inherits it. Fixing only where the
failure was caught would leave five suites to fail the same way on a busy
machine, one at a time, each looking like a fresh mystery.

## What to build

A **bounded, lock-specific** retry in the helper's `git` function: on a failure
whose stderr names `index.lock`, wait briefly and retry a few times, then fail
for real.

**Key on the lock message specifically.** A blanket retry would paper over real
git errors and turn a deterministic failure into a slow flaky one — the exact
opposite of the goal.

Contention is transient by definition: the holder finishes in milliseconds, so a
short retry converts a spurious failure into a marginally slower test.

## The test must force the race

Hold a lock deliberately, then assert the helper still succeeds.

**Running the suite proves nothing.** The race is load-dependent — locally it
failed with four agents running and passed 11/11 in isolation minutes later, on
the same commit. A test that relies on the race happening is a test that passes
for the wrong reason.

## Definition of Done

- The retry lives in `packages/board/test/helpers.mjs`
- A test that holds `index.lock` and asserts the helper survives it
- A non-lock git failure still fails immediately — prove the retry is specific
- `pnpm run test:board` passes
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass
- A changeset with a `bumps:` block

## Out of scope

- **`plot-fleet-scan.sh`** — the plan's remaining Open Point asks whether the
  scan itself should retry on lock rather than report. It currently reports
  deliberately (line 265 treats the lock as *an agent is writing HERE, RIGHT
  NOW*), and that is right for the fleet view. Do not change it; sibling
  branches own that file.
- Production board source. This is a test-harness fix.

## Note

`plot-fleet-scan.sh` already treats this exact condition as information rather
than failure. The system understands lock contention in production and not in
its own harness — that asymmetry is the bug, and the fix carries the same
understanding across.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
