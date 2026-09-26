# A sandbox does not inherit its host

> A contract test that builds a temp repository and dispatches into it writes its agent manifest into **the host repository's registry**, because `PLOT_REPO_ROOT` travels in the environment from a dispatched worker into the test it runs. Measured 2026-09-25: **19 of 20 manifests** in `.plot/agents/` were test fixtures, against three real desks, and the board rendered each as an agent.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1000
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 1
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel

## Changelog

- A test that sandboxes a repository scrubs `PLOT_REPO_ROOT` from the environment it hands to Plot's scripts, so the sandbox's own `## Plot Config` is read rather than the host's. `2 of 93` reconcile tests did this; the rest inherited whatever the surrounding process exported.

Board impact: **the symptom is entirely on the board.** Every leaked manifest becomes an agent row, so agent counts were inflated by test runs rather than by fleet activity.

## Motivation

**The hazard is already documented, by a test that defends against it.** `test/reconcile/approve-record-outside-comments.test.mjs:117-123`:

> `PLOT_REPO_ROOT` IS SCRUBBED, and the sandbox is the point. Since `config-takes-the-callers-root`, `plot-config.sh` prefers an exported `PLOT_REPO_ROOT` over `git rev-parse`, so a run inheriting one from a dispatched worker reads the HOST repo's `## Plot Config` rather than this sandbox's. […] The env must not decide it.

That is exactly what happened, in the tests that do not scrub.

### Measured 2026-09-25

```
manifests in .plot/agents/    20
  live pid                     3
  dead pid, temp-dir desk     17   ← test fixtures
```

Two rendered as agents sharing a desk named `feature/stopped` — a branch that exists neither locally nor on the remote — with desks under `/private/var/folders/.../plot-restart-*`, long deleted.

The leak is not per-`mkdtemp`; it is at the **three places an environment is built** and handed to a Plot script:

```
test/reconcile/dispatch.test.mjs:299    env: { ...process.env, PLOT_PLUGIN_ROOT: …, ...(opts.env ?? {}) }
test/reconcile/dispatch.test.mjs:3336   env: { ...process.env, ...env }
test/reconcile/restart.test.mjs:122     const env = { ...process.env }
```

At `:299` the `delete` must come **after** the `...(opts.env ?? {})` spread, or a caller passing the variable puts it back.

### Why the sandbox is otherwise correct

**The tests are not careless about isolation.** They pass `cwd: repo`, write the temp repo its own `CLAUDE.md`, and declare no `Agent registry` key — so the default `.plot/agents` applies. Verified directly:

```
$ (cd $TMPREPO && plot-config.sh get "Agent registry" ".plot/agents")
.plot/agents                    ← correct, relative, sandboxed
```

And `plot-dispatch.sh:1123-1126` resolves a relative value against `$repo_root`, which is the temp repo. **Every deliberate part of the isolation works.**

What defeats it is a variable nobody in the test mentions. `plot-config.sh:167` prefers an exported `PLOT_REPO_ROOT` over `git rev-parse --show-toplevel`; when a suite runs inside a dispatched worker's desk, that variable is already set to the host checkout, so the host's `CLAUDE.md` is read instead of the sandbox's. **On this estate** the key is absolute, so the value comes back absolute and `plot-dispatch.sh`'s relative-path arm never fires. A repository whose key is relative leaks one hop later instead — `plot-dispatch.sh:1125` resolves it against the **host** `$repo_root`. Same defect, different path; reading the wrong config is the fault, not the shape of the value.

**An earlier reading of this defect, recorded in #1000, was wrong.** It blamed `plot-config.sh` for finding its file by cwd. With `cwd: repo` the file is found correctly; the failure requires the inherited variable, which is why the manifests accumulated today — while agents were running suites inside their desks — rather than steadily over months.

### Why the precedence is right and stays

`plot-config.sh:158-166` argues for it, and the argument holds: the board exports `PLOT_REPO_ROOT` deliberately, and asking git once per config key cost **21 of 42 git spawns** in one board build. The variable is not the defect. **Inheriting it into a sandbox is.**

## Design

### The rule

**A test that builds a sandbox scrubs `PLOT_REPO_ROOT` from the environment it hands to Plot's scripts.** One line beside the `env` it already constructs:

```js
delete env.PLOT_REPO_ROOT;
```

The sibling at `approve-record-outside-comments.test.mjs:125` is the worked example, and its comment is the rationale — *the env must not decide it*.

### A rule is not enough here, and the estate says so

CLAUDE.md's *Gates Over Rules*: **can you answer "did I do this?" without doing the work?** For scrubbing, yes — which makes it a rule, and 91 of 93 tests already demonstrate how rules fare. A new test added next month inherits the same trap.

So the slice adds a gate as well: **a contract test asserting the registry is unchanged across the suite**, or an assertion in the shared helper that no manifest was written outside the sandbox. Which shape is the slice's to choose, but *"every test remembers"* is not a fix.

### What this does NOT do

- **It does not change `plot-config.sh`'s precedence.** That is deliberate, argued and measured; reverting it would restore 21 git spawns per board build.
- It does not change `plot-dispatch.sh`, which resolves correctly.
- It does not reap the manifests already leaked. They were cleared by hand on 2026-09-25 and a reaper for them is a separate question. `plot-reap.sh:690-718` already sweeps a manifest whose recorded worktree is gone, and has since #474 on 2026-08-27.

### Open questions

- [ ] **Should the registry refuse a manifest whose desk does not exist at CREATION?** An earlier answer said yes and made it slice 2; that answer rested on a refuted premise, since `plot-reap.sh:690-718` already sweeps such a manifest after the fact. Refusing to create one is a different question and remains open.
- [ ] **How many of the other 91 tests are exposed?** Only the four measured write manifests, but any test reading a config key in a sandbox has the same hazard, and the two that scrub found it independently.

## Done when

- The three env choke points scrub `PLOT_REPO_ROOT`, and a run with it exported writes no manifest into the host registry — **asserted with the variable deliberately set**, since that is the only condition under which the bug appears.
- **The regression test points `PLOT_REPO_ROOT` at a decoy temp root, never the real repository.** A test that fails by writing into the host registry is a test that causes the defect it defends against.
- A gate catches a future test that forgets, and its discriminator is **no manifest in the host registry names a worktree under the system temp directory** — not *"the registry is unchanged"*, which cannot be implemented: live agents write manifests during a suite run, and two were measured doing so.
- `plot-config.sh` is untouched.
- The two tests that already scrub keep passing unchanged.

## Slices

### A sandboxed test scrubs the host's root (Branch: bug/a-sandboxed-test-scrubs-the-hosts-root, PR: #1001)

- `bug/a-sandboxed-test-scrubs-the-hosts-root` — `delete env.PLOT_REPO_ROOT` at the three env choke points (`dispatch.test.mjs:299` **after** the `opts.env` spread, `dispatch.test.mjs:3336`, `restart.test.mjs:122`), following `approve-record-outside-comments.test.mjs:125`; a regression test that exports the variable **pointed at a decoy temp root** and asserts no manifest reaches the host registry; a gate whose discriminator is *no host manifest names a worktree under the system temp directory*, since live agents make *"unchanged"* unimplementable

## Notes

- **Built 2026-09-26 (#1001). The exposure is 12 manifests from ONE file, and the three named choke points did not carry it.** The gate fired on the first full `test:contracts` run after the choke-point scrubs landed: **12 manifests** in the host registry, every test green, the run failing only on the gate. All twelve came from `dispatch.test.mjs` — from `staff()` (`:71`) and the bare `execFileSync` calls that pass **no `env` at all** and so inherit the variable wholesale. The plan's three sites are the places an env is BUILT; these are the places one is not. `restart.test.mjs` has the same shape at `status()` (`:162`). So the scrub moved to `delete process.env.PLOT_REPO_ROOT` at module level in both files, and the per-helper deletes stay: each states the contract where a reader of that helper looks. **The answer to *"how many of the other 91 tests are exposed?"* is therefore a measurement rather than a count of files** — 50 of 94 files build an env over `...process.env` and 5 scrub, but only `dispatch.test.mjs` and `restart.test.mjs` reach `plot-dispatch.sh`'s manifest write, and both are now covered at file scope.

- **The gate is a post-suite check chained to `test:contracts`, not an assertion in the helpers.** The slice was free to choose. A helper assertion names the culprit test, which is better diagnostics — but **a test that forgets is precisely one that does not route through the fixed helpers**, which the twelve manifests demonstrate: each came from a site the helper fix did not touch. It is chained with `;` rather than `&&` so it runs after a FAILING suite too, where a leak is most likely, and the suite's exit code is preserved.

- **The plan's `plot-dispatch.sh:1125` sentence is corrected, as the brief asked.** A repository with a relative `Agent registry` does **not** leak one hop later for the manifest: `$repo_root` at `:1125` is `git rev-parse --show-toplevel` of the sandbox, so a relative key resolves inside the sandbox and the manifest lands harmlessly. Other config keys read from the host under an inherited `PLOT_REPO_ROOT` are still wrong. Nothing was built for it. **This also shaped the regression test's decoy**, which must declare an ABSOLUTE key or it reproduces nothing and passes on unfixed code.

- **"The system temp directory" is a SET on macOS, not a path.** Measured while testing the gate: a fixture desk under `/tmp` was reported clean by a check that knew only `os.tmpdir()`, which here is the separate per-user `/var/folders/…/T`. The gate reads `os.tmpdir()`, `TMPDIR`, `/tmp` and `/var/tmp`, all realpath'd.

- **The regression test's first red was for the WRONG reason, and the brief's instruction to watch it fail is what caught it.** A decoy declaring no `Worker command` made the unfixed run abort with `no 'Worker command' configured` **before** it wrote any manifest. The leak was real and the assertion never reached it — a red that would have gone green on fixed code while locking nothing. A faithful decoy then reproduced the leak, one manifest in the decoy registry, and the scrub cleared it.

- **Panelled 2026-09-26: slice 1 `amend`, `Evidence: executed`.** **The mechanism holds** — the juror tried to refute it and could not, reproducing the leak directly and then tracing the variable on the live fleet. The subtlety strengthens it: **no Plot script exports `PLOT_REPO_ROOT`.** It arrives by plain inheritance from the launchd supervisor's plist (`units/com.plot-pm.registryd.plist:44-45`) and travels supervisor → dispatcher → wrapper → worker loop → any suite that worker runs, measured on pids 1506 and 2949. Nothing a test could reasonably anticipate sets it, which is why scrubbing must be explicit. Four amendments, all applied: the sites were named by `mkdtemp` rather than by the three places an env is built; the regression test needed a decoy root so a failure cannot cause the defect; the gate as written was **unimplementable**, since live agents write manifests during a run; and *"the absolute key"* read as universal when it is this estate's. Verdict: `.plot/panels/a-sandbox-does-not-inherit-its-host/slice1.md`.

- **Panelled 2026-09-26: slice 2 `reject`, `Evidence: executed`.** **The sweep it proposed already exists.** `plot-reap.sh:690-718` loops the registry, tests `[ -d "$mwt" ] && continue` and removes the rest — landed in `923720c79` (#474) on **2026-08-27**, a month before this plan. Its comment names the same population: *"seven of them, measured 2026-08-26."* It is also **better than the proposed gate**: it needs only the absent desk, because *"nothing runs in a directory that does not exist"*, where the plan demanded a redundant liveness check that would have made the sweep narrower. Verdict: `.plot/panels/a-sandbox-does-not-inherit-its-host/slice2.md`.
- **The 19 manifests were clearable all along.** `plot-reap.sh:690-718` matches on a recorded worktree path that is not a directory, which every one of them satisfied. They accumulated because nobody ran the reaper, not because nothing could clear them — so the leak's cost is a noisy board between reaps rather than an unbounded registry. **That lowers the severity and does not remove the defect**: a suite should not write into the host's registry at all.
- **A FOURTH wrong reading of this defect**, recorded beside the other three: that nothing sweeps an orphaned manifest. Every one of the four was a plausible next guess, and every one was settled by reading the code rather than by argument.

- Found by an operator reading two agents sharing a desk named `feature/stopped` and asking what they were. Neither existed: dead pids, deleted temp desks, and a branch present nowhere.
- **Three readings of this defect were wrong before the reproduction settled it**, and the plan records them because each is a plausible next guess: that the e2e suite was the source (it is `test/reconcile/`, which runs routinely); that this repository's absolute `Agent registry` escapes the sandbox (the tests declare no such key, and the default is relative); and that a relative path resolves against the cwd (`plot-dispatch.sh:1123-1126` roots it at `$repo_root`). Only an inherited `PLOT_REPO_ROOT` produces it.
- **The precedence that makes it possible was added the same day**, in `config-takes-the-callers-root`, to stop the board spawning `git rev-parse --show-toplevel` 21 times per build. The change was right and its comment anticipated this exact risk. What it did not do was scrub the variable in the tests that would inherit it.
