# Implementation brief — production-calls (Spawning the scripts)

- **Plan (canonical):** `docs/plans/2026-08-28-production-calls-the-domain-one-rule-at-a-time.md` on main
- **Branch:** `feature/one-place-reaches-a-script` (base: `main`)
- **Ends as:** one PR to main
- **Gated with the plan** — see the Delivering brief.

### What to build

The board's calls to `plot-*.sh` give way to the adapter layer's single
`runScript()`.

**Measured 2026-08-30:** `packages/board/src` names a `plot-*.sh` on **36
lines**, and `fleet.ts` alone reaches `plot-host.sh` **11 times**. **Zero board
files use `runScript()`.**

### These are the point, and the exit-code contract is why

`runScript()` maps exit codes once: `0 → ok`, `1|3 → failed`, `4 → unaskable`.
**A second reading of 3-versus-4 collapses a permanent configuration fact into a
transient incident** — *"this host cannot be asked"* becomes *"this attempt
failed"*, and a caller retries something that will never work.

### The rule this enforces

`CLAUDE.md` § The Layering Rule: **scripts can only be called from an adapter
implementation.** `the-sprint-proves-its-own-goal`'s gate counts every breach and
ratchets from today's number toward zero — **this slice is what makes it fall.**

### Done when

- **no `plot-*.sh` is invoked from `packages/board/src/`**, asserted by grep so
  it cannot regress
- the board suite and browser suite pass **unedited**
- **no exit code is interpreted outside `runScript()`**

**"Unedited" is the assertion that carries this slice.** A move that needed a
test changed moved behaviour with it.

**One case to watch:** `plot-host.sh`'s `pr-list` does not check `gh`'s exit
code, and the script runs under `set -uo pipefail` with no `-e`. **A throttled
host yields empty output with a non-zero exit.** `runScript()` will now see that
exit where the board saw only the emptiness — which is an improvement, and a
behaviour change. `a-throttled-host-says-so` owns the adapter fix; **say in the
PR which of the two you are relying on.**

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`, artifact rebuilt,
changeset.

### Scope guard

`plot-*.sh` calls only. **Not `git`, `ps` or `tailscale`** — those are the next
slice, and they adopt *different* adapters through *different* contracts.
