---
'@plot-pm/board': minor
---

The board asks a port to run Plot's helper scripts, and no longer starts one
itself.

`packages/board/src/` invoked `plot-*.sh` on 28 lines across 15 files, and three
of those read the exit code themselves. Reading it twice is what this removes:
`plot-host.sh` answers 4 for *this backend has no such capability at all* and 1
or 3 for *this attempt failed*, and a second reading collapses a permanent
configuration fact into a transient incident — so a caller retries something
that will never work. `fleet.ts` matched `code === 4` by hand to tell a Bitbucket
with no issue tracker from a GitHub that was refusing.

That comparison now happens once, in the adapter, and what reaches the board is
a word rather than a number.

**Six call shapes, because the board really makes six.** `planMeta`/`config`
read; their `Sync` twins serve the write routes that are synchronous today;
`hostSaid` classifies and carries the host's own sentence, since a rate limit and
a DNS blip are both `failed` and only one is worth waiting for; `awaited` keeps
stdout, stderr and the code for the two scripts that explain themselves on the
way out — `plot-dispatch.sh` reports which branches it claimed while exiting
non-zero on a phase gate; `sourced` runs `plot-worker-state.sh` the way its two
shell callers do, so the eight worker states stay one implementation; `start`
runs detached and keeps its handle when a caller passes `onExit`, because
auto-deliver chains the reap and the ref release to that exit.

The port answers stdout verbatim rather than a shape. The scripts ARE the
plan-format and host contracts, and a second parse would be a second spelling of
them.

**Two gates, and they are different kinds.** The `plot-*.sh` gate is a refusal at
zero: this population could be finished in one branch and was, so a new
invocation fails the build rather than raising a budget. The broader spawn
ratchet tightens 54 → 28; what remains is `git`, `ps`, one `tailscale` and the
`sh -c` starts for a project's configured command, which reach different tools
through different contracts.

Every existing test passes unedited — 2545 across the board's 136 files,
browser suite included. That is the assertion the change rests on: a move that
needed a test changed moved behaviour with it.
