PLOT-BLOCKED: This wave is already implemented on main. Should the branch be
deferred, or is there a gap I have not seen?

## What I found

Every item in this branch's Definition of Done is already satisfied by
`origin/main`, implemented 2026-08-17 — one day BEFORE the plan asking for it
was written (2026-08-18). I have written no code, because writing any would
duplicate working, tested code.

The plan states "Nothing ever calls it." That was not true when the plan was
written. `packages/board/src/server/fleet.ts:806` calls `startRepair`.

## DoD, item by item (all verified by running the suites, not by reading)

| DoD item | Where it lives on main | Evidence |
|---|---|---|
| artifact-only conflict is detected | `plot-fleet-scan.sh:822 conflicts_of()` + `stuck.ts:115 isArtifactOnly()` | `conflicts.test.mjs` "an artifact-only set is distinguishable from a mixed one" |
| artifact + source file reports manual, naming both | `stuck.ts:164` → `'conflict'` with the sorted set attached | same test: asserts `[ARTIFACT, 'src/app.ts']` |
| a clean branch reports neither | `conflicts: []` + `conflicts_known: true` | "a branch that merges cleanly reports an empty, KNOWN set" |
| the scan writes nothing | `git merge-tree --write-tree` (in-memory) | "the scan writes NOTHING" — repo snapshotted byte-for-byte before/after |
| no host call, no worktree checkout | local `refs/remotes/` only | whole suite runs under `--offline` |

`pnpm test`, `test:reconcile` (457 pass), `test:e2e` (9 pass) green on this
worktree. `test:board` is flaky and this is a SEPARATE finding — see below.

## Second finding: `test:board` is order-dependent, and it is not mine

This branch changes NO source: `git diff origin/main --stat` touches only two
plan markdown files. So anything failing here fails on main.

`pnpm run test:board` failed once and passed on re-run, same command, same tree:

- run 1: `bridge: does not overwrite the file when a scan FAILS` FAILED
- run 2: `node --test test/*.test.mjs` → 109/109 pass

The timing names the cause. That test takes ~6001 ms standalone (it waits out a
deliberate timeout) and reported 0.0915 ms in the failing run — it did not run
its own wait, it read state a sibling left behind. `node --test test/*.test.mjs`
runs files concurrently and these share a tmpdir-backed board process, so the
failure is test isolation, not the product.

Worth its own bug branch. I did not fix it here: it is unrelated to this wave,
and widening scope into a flaky-test hunt is exactly what the brief forbids.

## Divergence from the brief worth a decision

The brief specifies the labels `conflict:artifact` / `conflict:manual` emitted
by `plot-fleet-scan.sh`. Main deliberately splits this differently:

- the SHELL SCAN reports the conflict SET and refuses to judge it
- the CLASSIFIER lives one layer up, in `packages/board/src/server/stuck.ts`,
  emitting `artifact-conflict` / `conflict`

Its stated reason is Manifesto Principle 3 — scripts collect and report, skills
interpret. Same facts, same narrowness, different seam and different label
spelling. I did not "fix" this to match the brief's wording: the split is
argued in comments at `plot-fleet-scan.sh:760`, and renaming across two layers
would be scope-widening, not implementation.

## The open point the brief told me to decide and report

"Is the artifact path configurable, or is `board-server.mjs` special-cased?"

Main special-cases it: `BOARD_ARTIFACT_PATH` in `packages/board/src/contract/schema.ts:948`.
I agree with that resolution, and the reason is stronger than the plan's framing.
The licence is not "this file is generated" — it is that THREE properties are
verified for THIS file (`-merge`, deterministic rebuild, CI no-diff gate). A
`Generated artifacts` config key would let an adopting repo name a file with
none of those properties and inherit an automatic write it has not earned. It
stays project-agnostic because the constant lives in the board package, not in
`skills/plot/scripts/` — the shell scan never learns which file is special.

## Third finding: wave 2 has ONE real gap — the off switch does not exist

I checked waves 2 and 3 before recommending they be deferred, and they are not
equally done.

- wave 3 (`feature/a-repaired-row-says-so`) — DONE. `repairFor()` at
  `resolver.ts:175`, rendered at `fleet.ts:1990`.
- wave 2 (`feature/the-pulse-repairs-the-artifact`) — done EXCEPT the off
  switch. `grep -rn PLOT_BOARD_REPAIR packages/board/src skills docs` matches
  the plan and NOTHING else. The repair is gated by `mayResolve()` on state
  alone (`resolver.ts:80`); there is no environment variable, so there is no way
  to keep the detection while stopping the writes.

The plan calls that constraint non-optional:

> A pulse that writes must be refusable without stopping the board.
> [...] The default is on.

So an operator who wants to watch the conflicts without the board acting on them
currently cannot have that, and the only off switch is stopping the board. This
is the one piece of this plan that is genuinely unbuilt.

It is NOT mine to build — wave 2 is explicitly excluded by my brief ("Do not
repair anything. The pulse-side repair is wave 2 and is not yours"), and the
DoD I was given does not mention it. Flagging it rather than taking it.

## What I recommend

1. Defer THIS branch (wave 1) and wave 3 — both are fully implemented on main.
2. Keep wave 2 open, scoped down to just `PLOT_BOARD_REPAIR`. Everything else
   in it already landed 2026-08-17.
3. Mark the rest of the plan Delivered against those commits rather than
   re-implementing it.
4. Separately: file the `test:board` isolation flake (finding 2).

I have opened no PR, because there is no change to propose.

Re-derived from git refs; nothing in this worktree was modified.
