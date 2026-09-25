# A sandbox does not inherit its host

> A contract test that builds a temp repository and dispatches into it writes its agent manifest into **the host repository's registry**, because `PLOT_REPO_ROOT` travels in the environment from a dispatched worker into the test it runs. Measured 2026-09-25: **19 of 20 manifests** in `.plot/agents/` were test fixtures, against three real desks, and the board rendered each as an agent.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1000
- **Sprint:** a-refusal-names-what-it-cannot-see

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

The four sites:

```
test/reconcile/dispatch.test.mjs:1420   plot-realworker-
test/reconcile/dispatch.test.mjs:1565   plot-wrappid-
test/reconcile/dispatch.test.mjs:2944   plot-sessenv-
test/reconcile/restart.test.mjs:52      plot-restart-
```

### Why the sandbox is otherwise correct

**The tests are not careless about isolation.** They pass `cwd: repo`, write the temp repo its own `CLAUDE.md`, and declare no `Agent registry` key — so the default `.plot/agents` applies. Verified directly:

```
$ (cd $TMPREPO && plot-config.sh get "Agent registry" ".plot/agents")
.plot/agents                    ← correct, relative, sandboxed
```

And `plot-dispatch.sh:1123-1126` resolves a relative value against `$repo_root`, which is the temp repo. **Every deliberate part of the isolation works.**

What defeats it is a variable nobody in the test mentions. `plot-config.sh:167` prefers an exported `PLOT_REPO_ROOT` over `git rev-parse --show-toplevel`; when a suite runs inside a dispatched worker's desk, that variable is already set to the host checkout, so the host's `CLAUDE.md` is read and its **absolute** `Agent registry` is returned. The relative-path arm never fires, because the value was never relative.

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
- It does not reap the manifests already leaked. They were cleared by hand on 2026-09-25 and a reaper for them is a separate question — though worth noting: **nothing reaps a manifest whose desk is gone**, because the supervisor reaps desks.

### Open questions

- [ ] **Should the registry refuse a manifest whose desk does not exist?** It would have bounded this regardless of the env, and bounds the next cause too. Orthogonal to the fix here, and a better safety net than either.
- [ ] **How many of the other 91 tests are exposed?** Only the four measured write manifests, but any test reading a config key in a sandbox has the same hazard, and the two that scrub found it independently.

## Done when

- The four sites scrub `PLOT_REPO_ROOT`, and a run with it exported writes no manifest into the host registry — **asserted with the variable deliberately set**, since that is the only condition under which the bug appears.
- A gate catches a future test that forgets: the suite fails if it leaves the host registry changed.
- `plot-config.sh` is untouched.
- The two tests that already scrub keep passing unchanged.

## Slices

### A sandboxed test scrubs the host's root (Branch: bug/a-sandboxed-test-scrubs-the-hosts-root)

- `bug/a-sandboxed-test-scrubs-the-hosts-root` — `delete env.PLOT_REPO_ROOT` at the four sites in `dispatch.test.mjs` and `restart.test.mjs`, following `approve-record-outside-comments.test.mjs:125`; a regression test that exports the variable and asserts no manifest reaches the host registry; a gate failing the suite if the host registry changes across a run

## Notes

- Found by an operator reading two agents sharing a desk named `feature/stopped` and asking what they were. Neither existed: dead pids, deleted temp desks, and a branch present nowhere.
- **Three readings of this defect were wrong before the reproduction settled it**, and the plan records them because each is a plausible next guess: that the e2e suite was the source (it is `test/reconcile/`, which runs routinely); that this repository's absolute `Agent registry` escapes the sandbox (the tests declare no such key, and the default is relative); and that a relative path resolves against the cwd (`plot-dispatch.sh:1123-1126` roots it at `$repo_root`). Only an inherited `PLOT_REPO_ROOT` produces it.
- **The precedence that makes it possible was added the same day**, in `config-takes-the-callers-root`, to stop the board spawning `git rev-parse --show-toplevel` 21 times per build. The change was right and its comment anticipated this exact risk. What it did not do was scrub the variable in the tests that would inherit it.
