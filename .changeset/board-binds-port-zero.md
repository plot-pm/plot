---
"plot": patch
---

The board binds its port once and reports the port it bound.

A port was chosen at one moment and used at another, with nothing carrying the
answer between them. On 2026-08-16 that cost three separate incidents: a CI
flake on PR #131 (`a plans dir NESTED in an unrelated repo borrows nothing from
it`, passing on rerun with the identical commit), a `pnpm board` that refused to
start with a raw `EADDRINUSE` stack trace, and a tab bookmarked on a port whose
server had died.

**`PORT=0` binds zero and reports what the OS assigned.** The default stays
7777 — a development board on a random address is not bookmarkable, and
`pnpm board` would land somewhere new every time.

**The bound port reaches the same-origin check.** `const PORT` was evaluated at
module load, before `listen()`. Under `PORT=0` the constant stayed `0` while the
real port was something else, so `/api/dispatch`'s allowlist would have read
`http://localhost:0` and refused **every** browser origin — silently disabling
Start work, the one endpoint that spawns processes. The port now comes from
`server.address()` inside the listen callback. That inconsistency existed
already; `PORT=0` only made it impossible to ignore.

**`findFreePort` is deleted**, and all 28 call sites across 8 test files read
the started server's port instead. The helper bound port 0, read the number,
**closed**, and handed it to a different process to bind later — a
time-of-check-to-time-of-use race that CI, running test files in parallel on one
machine, lost often enough to gate a plan PR. `startServer` already parsed the
port out of the readiness line it waits on and discarded it. It is not fixed
with a retry loop: a test that fails once in fifty runs is harder to diagnose
than one that never does.

**A second `pnpm board` names the running one and exits 0.** The failed
`listen()` is the check — probing beforehand would rebuild the very race being
removed. It reports and stops; it never kills the running board, because several
worktrees run side by side and a `pnpm board` in one terminal shooting down
another's is a worse failure than the one being fixed. Seven board servers
accumulated on 2026-08-16, at 80 GraphQL calls/hour each, because nothing
connected a new invocation to an existing one.
