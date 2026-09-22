# Coverage lens — a failed tick must not end the daemon

Position: refuted

Evidence: executed

Subject: `docs/plans/2026-09-22-a-failed-tick-must-not-end-the-daemon.md`, merged as `65071ef52`.

## The question this lens was given

Round 1 proved the four promised tests do not exist. "Write the four tests" is worthless advice if the seam does not admit them, so my job was to establish what such a test must look like and whether the estate can carry one.

**It can. I wrote all four and ran them.** They pass against the merged code, three of the four fail against the pre-fix code, and the whole file runs in **2.79 s** in the existing `parallel` vitest project with **no production change of any kind**.

So the finding is not *the architecture forbids the tests*. It is the opposite, and it is worse for the delivery: **the tests were cheap, the seam was already built, and they were simply not written.**

I refute — on that, and on two coverage findings round 1 did not reach.

## 1. Does each deliverable the plan named appear in the merged code?

Two of three, and I concur with round 1's table rather than re-deriving it. The `try`/`catch` is at `registryd-main.ts:828-857`, the entry `.catch` at `:1004-1014`, and `git show 65071ef52 --stat` lists three files: a changeset, the source, the rebuilt artifact. **No test file.**

What I add is the measurement of *why that matters*, below.

## 2. Do the plan's four guards hold?

Round 1 measured all four against the shipped artifact in a sandbox and found them holding. I did not repeat that work — I measured the same four **as unit tests against the TypeScript source**, which is the form the slice promised. All four hold in that form too, which is a stronger result than either alone: the guards are true of the source, not only of the minified artifact.

## 3. What I executed versus only read

### Executed — the four promised pins, written and run

I wrote `packages/board/test/unit/zz-coverage-probe.test.ts` with exactly the four pins the slice names, and ran it:

```
cd packages/board && ./node_modules/.bin/vitest run --project parallel \
    test/unit/zz-coverage-probe.test.ts
  → Test Files 1 passed (1)   Tests 4 passed (4)   Duration 2.79s
```

The shape is one `vi.mock` and nothing else:

```ts
vi.mock('../../src/server/entry/registryd.js', async (orig) => {
  const actual = await orig<typeof import('../../src/server/entry/registryd.js')>();
  return { ...actual, tick: vi.fn() };
});
```

and then `run` is called with its own injected collaborators:

```ts
await run(['--once'], hereDir, write, sleep, stop, warn);
```

**Nothing else needs stubbing.** `run`'s signature already takes `write`, `sleep`, `stop` and `warn` as parameters with production defaults, and `PLOT_REPO_ROOT` redirects the repo root to a `mkdtempSync` sandbox. The world, the queue, the performer and the registry directory are all built inside `run` from that root — and every one of them is lazy: `worldForRepo`, `queueWorldForRepo` and `performerShell` build closures and reach nothing, and `registryDirFor` goes through `runProcessSync`, which catches (`packages/domain/src/adapters/run-script.ts:106-126`). **A test needs to stub the registry, the world, the queue and the performer: none of them.** Only `tick`.

### Executed — the pins are discriminating, not decorative

A passing test proves nothing about the change unless it fails without it. I copied the pre-fix source in and re-ran:

```
git show 65071ef52^:packages/board/src/server/entry/registryd-main.ts > <scratch>
command cp -f <scratch> packages/board/src/server/entry/registryd-main.ts
grep -c "tick failed" …/registryd-main.ts   → 0   (swap confirmed real)
git diff --stat                             → 17 insertions, 63 deletions
./node_modules/.bin/vitest run --project parallel test/unit/zz-coverage-probe.test.ts
  → Tests 3 failed | 1 passed (4)
```

The three failures are the throw escaping `run` unhandled — `Error: boom`, `Error: boom 1`, `Error: boom`, the second with the frame `Module.run src/server/entry/registryd-main.ts:812:26`. The one that passes is my healthy-tick control, which is exactly right: a control must not move.

Restored with `git checkout --`, never from my own copy; `git diff --stat` clean afterwards.

**This is the measurement that settles the lens.** The four pins exist, take about forty lines, run in under three seconds, and separate the merged code from its predecessor. The commit message cited *"registryd unit tests: 123 pass"* as its evidence; round 1 showed that number is unchanged by the fix. The number that WAS available for the asking is `3 failed | 1 passed`.

### Executed — the two harder seams

A second probe file tested what the first did not:

| question | measured |
|---|---|
| is the interval actually waited, or does it spin? | `waits` collected `[7000, 7000]` over two failed ticks at `--interval 7` — pinnable |
| is the stdout/stderr split visible to a test? | yes; `err` contains the message, `out` does not |
| can `reportTick` be stubbed to test the post-tick path? | **no** — the ESM export binding is read-only and assignment throws |
| is the entry `.catch` reachable from a unit test? | **no** — its `import.meta.url === file://process.argv[1]` guard is false under any importer, by design and by its own comment |

### Executed — round 1's defect, as a unit test

Round 1 found that `reportTick` and `startAgents` run *outside* the `try`. I pinned that from a unit test by mocking `tickLine`, which `reportTick` calls:

```
DEFECT PIN: a throw AFTER the tick still ends the loop  → passed
  escaped.message === 'post-tick boom'
  warn never received 'tick failed'
```

The throw escapes `run` entirely. **Round 1's finding is not only true, it is regression-lockable in the same file, with the same shape, at the same cost.**

### Executed — the entry `.catch` has no reachable trigger

The plan scopes the entry `.catch` to *"an error thrown while parsing arguments, before the loop starts"*. I looked for anything that reaches it:

```
PLOT_REPO_ROOT=<sbx> node …/plot-registryd.mjs --max lots
  EXIT=2, usage line on stderr        ← argsFrom returns null; it does not throw
PLOT_REPO_ROOT=<sbx> PLOT_SCRIPTS_DIR=/nonexistent/nope …  --once
  EXIT=0, healthy tick                ← no throw
PLOT_REPO_ROOT=/nonexistent/repo …  --once
  EXIT=0, healthy tick                ← no throw
```

None reaches it. Reading the path confirms why: `argsFrom` returns `null` on every bad argument and `run` returns `2`; the four pre-loop builders are closures or go through `runProcessSync`, which catches everything. **The plan's own stated cause for the second half of the fix cannot be produced.**

### Read only

The plan, round 1's `behaviour.md` and `panel.md`, `registryd-main.ts`, `registryd.ts`, `workflows/supervise.ts`, `rules/supervision.ts`, `adapters/run-script.ts`, `adapters/scripts/scripts-shell.ts`, `vitest.config.ts`, and all three registryd test files. I read the live `.plot/logs/registryd.log` and `registryd.err` and ran `ps`.

I did not run `test:e2e`. I killed no worker and no supervisor.

## 4. What does the plan claim that the code does not do?

Round 1 named the false premise — `tick` already had a `catch` at `registryd.ts:178`. I confirmed it and will not re-argue it. Two claims are mine:

**(a) "Tests pin that …" — the slice's own sentence, in the present tense, about four tests that do not exist.** This is the deliverable, not a nice-to-have, and the lens's job was to find out whether the architecture is the excuse. **It is not.** `run` is `export const run` at line 779; it takes four of its five collaborators as parameters; its one hard dependency is a single module import that `vi.mock` handles; the `import.meta.url` guard at `:1004` exists *specifically* so an importer gets no loop, and its own comment says so — *"Only when RUN, never when imported — a test importing `run` must not have the process loop under it."* **Somebody built this seam deliberately for a test that was then not written.**

**(b) The entry `.catch`'s stated purpose is unreachable, so it is untestable for the reason it is unnecessary.** The plan calls it *"the second half, and not a substitute"* for failures *"before the loop starts"*. I could produce no such failure. Meanwhile round 1 measured what it DOES catch in practice — mid-loop deaths from `reportTick` and `startAgents` — and those it mislabels *"failed to start"*. So the untestable half of the fix is the half whose contract is wrong: it is documented for a case that cannot happen and silently serves a case it describes incorrectly.

## 5. Is there a defect nobody has noticed?

**Yes — and it is a coverage defect, which is this lens's own subject.**

`packages/board/test/unit/registryd-main.test.ts` is 734 lines and imports four of the file's nine exports: `argsFrom`, `readRegistry`, `reportTick`, `startAgents`. It does not import `run`. Nor does `registryd-tick.test.ts` (910 lines) or `registryd-units.test.ts` (195 lines). `grep -n "\brun(" packages/board/test/unit/registryd-*.test.ts` returns **nothing across all three files**.

**So `run` has never been under test, and the gap predates this plan by months.** That is the defect: the daemon's entire control flow — the loop, the `--once` branch, the exit code, the order of `tick` then `reportTick` then `startAgents`, the interval wait, the `stop()` contract — is covered by zero tests, while the four *pure* functions around it have 734 lines of them. The test file is dense, thoughtful and carefully reasoned, and it tests everything except the part that runs.

This is why the suite could not see the change, and it is a larger finding than the four missing pins. Adding them fixes this delivery. It does not fix the fact that the next change to `run` will land equally blind, because three of `run`'s behaviours — the interval wait, the `startAgents` ordering, the `--once` exit code — are pinned by nothing at all and I verified each is pinnable in the same forty-line shape.

**A second observation, offered as such rather than as a finding.** The supervisor is alive as I write — `pid 3260`, 10:31 uptime, `--start-agents`. It was dead when round 1 wrote. Across the entire recorded log, `grep -c "tick failed"` is **0** in both `registryd.log` and `registryd.err`, and `grep -c "incomplete"` is **0**. `registryd.err` is still 0 bytes, mtime Sep 8. By the plan's own observability criterion — *"a surviving daemon that logs a tick failure has hit this class"* — nothing has ever hit the class this change removes. I do not claim that proves the cause lies elsewhere; I claim the instrument has now been reading for hours and has recorded nothing.

## The smallest change that would make the pins writable

**None. That is the answer, and it is the finding.**

All four are writable today, in `packages/board/test/unit/`, in the `parallel` project, against the current source, with one `vi.mock` and a `mkdtempSync` sandbox. I wrote them and they run in 2.79 s. No export needs adding, no parameter needs injecting, no seam needs extracting, and no domain workflow is needed — `workflows/supervise.ts` holds the per-tick decision and correctly contains no loop, so the loop's failure behaviour belongs exactly where it is, in `run`, and is testable exactly where it is.

Two smaller changes WOULD be needed for coverage the plan did not promise, and they should be named so the follow-up scopes them honestly:

1. **To pin round 1's post-tick defect the way I did**, a test mocks `tickLine` rather than `reportTick`, because the ESM binding is read-only. That works but is indirect. Moving the `try` to cover the whole loop body — round 1's own recommendation — makes the pin direct and removes the need for the trick.
2. **The entry `.catch` is not unit-testable at all**, by the deliberate design of its `import.meta.url` guard. Testing it needs a subprocess against the built artifact, which is `test:e2e` territory. Since I could produce no input that reaches it, the honest follow-up is to fix its message and its documented scope first, then decide whether it warrants a subprocess test — not to promise a unit pin that the guard forbids.

## Why refuted

The guards hold and the mechanism is sound; round 1 established that by execution and I confirmed it in a second form. I refute on the delivery, and my grounds are narrower and harder than round 1's:

- **the four promised tests are writable as stated, and were not written.** Forty lines, 2.79 s, no production change, and `3 failed | 1 passed` against the pre-fix code. The architecture offered no resistance at all;
- **the seam was built on purpose for exactly this test** — `run` is exported and the import guard's comment names the importing test it protects — so the slice did not discover a hard problem, it skipped an easy one;
- **`run` is invoked by zero tests across 1,839 lines of registryd unit tests**, which is why the suite was blind and why the next change to the loop will be blind too;
- **the entry `.catch` is documented for a failure I could not produce** and, per round 1, mislabels the failures it actually catches.

What I would ask for, added to round 1's list: write the four pins as a `run`-driving unit test — the shape is settled and measured — and add the fifth, the post-tick regression lock, in the same file, since it costs one more mock and pins the defect round 1 found.

## Repository state

`git status --porcelain` at the end of my work showed two files I did not expect: `zz-coverage-probe.test.ts` and `zz-coverage-probe2.test.ts` as **staged deletions rather than untracked files**. They were my scratch probes, swept into commit `a46614cbc` by the coordinator's `git add -A` and pushed to `origin/main`.

**Resolved during this session.** I reported it rather than silently fixing it; the coordinator removed both files in `872cc0105` ("plot: remove two scratch probes my own git add swept in") and pushed. Verified: `git ls-tree origin/main packages/board/test/unit/ | grep zz` returns nothing. My working tree now holds exactly one file, this verdict.

My own subject files — `registryd-main.ts` and the board artifact — are clean, verified by `git diff --stat` after restoring the pre-fix swap with `git checkout --`, never from my own copy.
