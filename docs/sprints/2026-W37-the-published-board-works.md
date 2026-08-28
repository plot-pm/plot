# Sprint: The published board works

> A board installed from npm cannot scan. It answers `bash exited 127` and
> never becomes ready — in every release since v2.5.0. This sprint makes the
> published package work, and makes its failures legible when they happen.

## Status

- **Phase:** Active
- **Start:** 2026-08-28
- **End:** 2026-08-31
- **Release:** 2.11.1

## Sprint Goal

**Someone who installs `@plot-pm/board` gets a board that works.**

Measured 2026-08-28 against the published `@plot-pm/board@0.9.0` tarball, in a
fresh git repo:

```
files in the package                    4
helper scripts the server spawns       11
shipped                                 2
result             bash exited 127, ready:false forever
```

**Nine releases shipped this** — v2.5.0 through v2.11.0, since 2026-08-16.
**It is not a 2.11.0 regression**, and 2.11.1 is the first release in which the
published board works at all.

**Nobody wrote the bug.** The `files` whitelist was correct when set
(2026-07-14, when the board spawned exactly those two scripts). Nine spawns
were added over six weeks, each by a change that was correct in itself, and
none had reason to touch a package manifest. **No review catches a defect that
is in no diff** — only a gate does.

## MoSCoW

### Must Have

- [ ] [a-published-board-brings-its-scripts] The published package carries every helper script the server spawns, and a gate packs the tarball and runs the board out of it — measured: 2 of 11 shipped, `bash exited 127`, nine releases

### Should Have

- [ ] [a-cold-board-says-it-is-warming] The fleet view says it is waiting for its first pulse rather than rendering as empty — measured: 0 rows at t+10s and t+20s, 60 at t+30s. **With no warming state, `127` looks like *nothing to show***
- [ ] [a-board-says-which-repo-it-serves] The header names the repository being served — measured: `serverInfo()` carries `port` and `branch` but not the repo path, and a stray board on the usual port cost two hours on 2026-08-28

## Notes

### One Must, and the gate is the deliverable

**Nine filenames fix it today.** A list of nine filenames falls behind again,
for the same reason it fell behind the first time — so the plan's real
deliverable is a check that **derives** the list from the code, plus a
pack-and-run that boots the board from the tarball and asserts `ready: true`.

### Why the two Shoulds are here and not in W36

**They are what makes this failure invisible rather than merely present.** A
user who installs a broken board sees an empty screen with no explanation and
no way to tell *broken* from *pointed at the wrong repo*. **The Must makes the
board work; the Shoulds make its failures legible.** Shipping the fix without
them leaves the next failure just as silent.

### What this sprint does not touch

**The eight completion items in W36 stay there.** They are real and none of them
stops anyone using the board — which is the line this sprint draws.

### Scope Changes

<!-- logged here as the sprint's contents change -->
