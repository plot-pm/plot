# A published board brings its scripts

> A board installed from npm never becomes ready, and **two independent defects have to be fixed before it does**. The package ships 2 of the 11 scripts its server spawns (`bash exited 127`), and the fleet scan exits before its terminal `pulse` line when a repo has **no plans** — which is every new user's repo. Fixing either alone leaves the board unusable. Broken since v2.5.0.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-published-board-works
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-28, Jan Wloka, in-session

## Approval

- **Assignee:** Jan Wloka

## Changelog

- A board installed from npm can scan. The published package now carries every helper script the server spawns, and a release gate runs the board out of the packed tarball to prove it.

<!-- Board impact: the package manifest and the build. No source change to the
     board itself — the artifact is already correct, it simply arrives without
     the scripts it calls. -->

## Motivation

**Measured 2026-08-28 against the published `@plot-pm/board@0.9.0` tarball**, in
a fresh git repo, installed the way a user installs it:

```
t+10s  rows=0  ready=false  error=none
t+20s  rows=0  ready=false  error=bash exited 127
t+30s  rows=0  ready=false  error=bash exited 127
t+40s  rows=0  ready=false  error=bash exited 127
```

**It never becomes ready.** `127` is *command not found*: the server spawns
`plot-fleet-scan.sh` and the file is not there.

| | |
|---|---|
| files in the published package | **4** |
| helper scripts the server spawns | **11** |
| shipped | **2** — `plot-config.sh`, `plot-plan-meta.sh` |

**The nine missing:** `plot-fleet-scan.sh`, `plot-host.sh`,
`plot-worker-state.sh`, `plot-dispatch.sh`, `plot-approve.sh`,
`plot-deliver.sh`, `plot-reap.sh`, `plot-release-refs.sh`,
`plot-resolve-artifact.sh`.

### Shipping the scripts is not enough — measured

**Tested before planning, not assumed.** With all 11 scripts staged beside the
artifact and `PLOT_SCRIPTS_DIR` pointed at them, in a repo with **no plans**:

```
t+20s  ready=false  rows=0  error=fleet scan ended without a terminal pulse line
t+40s  ready=false  rows=0  error=fleet scan ended without a terminal pulse line
```

**The 127 is gone and the board is still dead.** Add one plan to the same repo
and it works — `ready=true`, 1 row, at t+20s.

**The cause is an early exit.** `plot-fleet-scan.sh:2624` handles the no-plans
case by printing a message and a `summary:` line, then `exit 0` — **before the
`--stream` terminal `pulse` line at :3407.** A board consuming the stream waits
for a line that is never coming, and reports the wait as a scan failure.

**Every new user has zero plans.** So this is not an edge case behind the
packaging bug; it is the *first* thing anyone installing Plot meets, and the
packaging fix merely reveals it.

> **This is the finding that changed the plan.** An earlier draft had one Must —
> ship the scripts — and a Done-when that a packed board reaches `ready: true`.
> **That would have been implemented, merged, and left the board unusable**, and
> the proof-of-fix passed only because the scratch repo had a plan in it. A test
> that quietly meets the precondition it should be checking is worse than no
> test.

### Nobody wrote this bug

**The `files` list was correct when it was written.** On 2026-07-14,
`cee4d94e` ("make @plot-pm/board a self-contained npm package") set it to
exactly the two scripts the board spawned at that commit — verified by reading
the server sources at that revision.

**It broke by drift.** `c1ae02c2` (2026-08-16) added the third spawn, and eight
more followed. **Every one of those commits was correct on its own**, and none
had reason to think about a whitelist in a package manifest. No review would
have caught it, because the defect is not in any diff.

**Nine releases shipped it** — v2.5.0 through v2.11.0, twelve days. So this is
**not a 2.11.0 regression**, and the patch is not a rollback of anything: it is
the first release in which the published board works.

### Why CI never saw it

**Every CI job runs inside this repository**, where all 24 scripts sit on disk
at `skills/plot/scripts/`. The board finds them because they are *there*, not
because they were shipped. **The published package is the one artifact nothing
tests.**

`scripts/release-smoke.sh` was written for exactly this seam and still missed
it: it exercises the **built** artifact in the working tree, not the **packed**
one. The distinction is the whole bug.

## Design

### Approach

**Nine filenames into `files`, and the build vendors them beside the artifact**
— the same mechanism `plot-config.sh` and `plot-plan-meta.sh` already use
(`build.mjs` copies them to the package root; `scriptsDir` resolves to
`path.resolve(here, '..')`).

**No source change.** The board is correct; it simply arrives without the
scripts it calls.

### The gate is the actual deliverable

**A list of nine filenames will fall behind again**, for the same reason it fell
behind the first time: the person adding the tenth spawn has no reason to look
at a package manifest. **So the fix that lasts is not the list — it is a check
that derives the list from the code.**

Two parts, both mechanical:

**1. Derive, then compare.** Grep the server sources for `'plot-*.sh'`, compare
against `files`, fail on any difference. That is a gate in the repo's own sense:
*"can you answer 'did I ship them all?' without doing the work?"* — no, you
grep.

**2. Pack and run.** `npm pack`, unpack to a temp dir, start the board from the
tarball against a scratch repo, and **assert it reaches `ready: true`.** This is
the check that would have caught the original drift *and* catches whatever the
grep misses — a script that is shipped but not executable, a `build.mjs` that
copies to the wrong place.

**Part 2 subsumes part 1**, and both are wanted: the grep names the missing file
in one line, the pack-and-run proves the whole thing works. A failing grep is a
fixable message; a failing pack-and-run is the truth.

### Where it runs

**In CI, on the release path** — not on every PR. Packing and booting a board
costs ~40 s, and the defect it catches can only ship at release time.

`scripts/release-smoke.sh` grows a section for it, so the one script that
already asks *"does this work for someone who installs it?"* is the place that
answers it.

## Waves

### Shipping (Branch: bug/the-package-carries-its-scripts)

The nine filenames in `files`, vendored by `build.mjs` beside the two that
already are.

**Done when** `npm pack` produces a tarball containing all 11 scripts, and a
board started from it **in a repo that has at least one plan** reaches
`ready: true`. **The empty-repo case belongs to the next wave** and does not
pass here — stating that plainly so this wave is not read as the whole fix.

### Streaming (Branch: bug/an-empty-estate-still-pulses)

`plot-fleet-scan.sh`'s no-plans exit emits the terminal `pulse` line under
`--stream` before returning. **An empty estate is a valid answer, not a
failure** — the scan already says so in its own summary, and the stream must say
the same.

**Done when** a board on a repo with no plans reaches `ready: true` and renders
an empty fleet, with no error, and `--stream` on an empty estate ends with a
`pulse` line.

### Gated (Branch: bug/the-package-proves-it-carries-them)

The two checks: the derived-vs-declared grep, and pack-and-run in
`release-smoke.sh`.

**The gate boots the packed board TWICE** — against a repo with **no plans** and
one with a single plan — and requires `ready: true` from both. **The empty case
is the new-user path**, and it is exactly the one the first version of this plan
missed by adding a plan to its scratch repo before looking.

**Done when** deleting any one script from `files` turns the gate red and names
it, and removing the streaming fix turns the empty-repo case red.

## Notes

**Two W36 items move here**, because they are what makes this failure
*invisible* rather than merely present:

- **`a-cold-board-says-it-is-warming`** — a user who installs this sees an empty
  board and no explanation. With no warming state, `127` looks like *nothing to
  show*.
- **`a-board-says-which-repo-it-serves`** — identity is how a reader tells
  *broken* from *pointed elsewhere*. It cost two hours on 2026-08-28.

**Neither is required for the fix**, and both belong in the same release: the
patch makes the board work, these two make its failures legible.

**This plan does not audit the other packages.** The root `plot` package ships
the skills tree and has its own manifest; whether *it* is complete is a separate
question and a separate measurement.
