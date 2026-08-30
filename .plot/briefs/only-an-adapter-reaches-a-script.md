# Implementation brief — the-sprint-proves-its-own-goal (Layering)

- **Plan (canonical):** `docs/plans/2026-08-30-the-sprint-proves-its-own-goal.md` on main
- **Branch:** `infra/only-an-adapter-reaches-a-script` (base: `main`)
- **Ends as:** one PR to main
- **Independent of the other two slices**, and of everything else in the sprint.

### What to build

A CI gate counting `spawn`/`execFile` outside
`packages/domain/src/adapters/`, ratcheting from today's number toward zero.

### Land it BEFORE the migration, not after

**This is the whole timing argument.** `production-calls` removes these call
sites. A gate that lands after it counts zero and proves nothing — a ratchet
with no rungs left. **Landed now, it records the migration while it happens and
stops the number rising in the meantime.**

### Three doors, not one — the gate counts all of them

**Extended 2026-08-30 by the operator: the rule is not about scripts, it is
about reaching the world at all.** Processes, services and the disk are the same
breach in three disguises, and a gate that catches one invites moving to the
others.

```
                                   domain outside adapters/   board
spawn / execFile                          0                     65
fs writes (writeFile, mkdirSync, …)       0                     63
fs reads  (readFile, existsSync, …)       0                     —
fetch / HTTP                              0                      0   ← server
```

**The inner boundary is dense everywhere**, and not by discipline: the purity
gate forbids `from 'fs'` and `from 'node:…'` outside `adapters/`, so a file
access cannot be written there. **This slice's job is the outer boundary**,
where nothing holds.

**Count `fetch` even though it is zero today.** A gate at zero is what stops the
first violation arriving unnoticed, and it costs nothing while the number holds.

**`packages/board/src/app/` is NOT a violation and must be excluded, with the
reason written down.** Its 21 `fetch` calls are the browser client talking to
its own server over `/api/…`. The client is the caller and that route is the
seam itself — an adapter between them would be a layer with no boundary. **The
server side (`packages/board/src/server/`) reads 0 and must stay there.**

**Two more the count already sees, and one it does not:**

- `packages/board/src` names a `plot-*.sh` on **36** lines — a subset of the 65
- **one `tailscale` call** at `server/index.ts:800`, a foreign process invoked
  straight from a route handler. `production-calls`' `one-place-reaches-a-process`
  slice names it explicitly, and the `execFile` count catches it for free

**Re-derive it before setting `allowed`.** Two workers are in flight touching
these files, and a number you did not take yourself is one you cannot defend.

### Follow the vocabulary gate — it is the working model

`.github/workflows/ci.yml:194`:

```yaml
allowed=10  # 2026-08-29: the entity rename took it 12 -> 10; the target is 0
```

**Three things to copy:**

- **the dated comment with the previous value** — that is what makes it a
  ratchet rather than a threshold
- **the failure message names the files**, not just the count
- **the documented exception.** The vocabulary gate excludes a quoted wire key,
  because a foreign process emits `waves` and an adapter must name it once.
  **Expect an equivalent here** and write its reason beside it.

### The rule this enforces

`CLAUDE.md` § *The Layering Rule*:

> **Scripts can only be called from an adapter implementation.**
> `controller → domain → port ← adapter → script`

**The gate asks nothing about intent.** It does not judge whether a call is
"domain logic" — no grep can. It asks only whether anything outside `adapters/`
spawns. **That is why the purity gate works**, and this is its mirror on the
outer boundary.

### Done when

- the gate fails when a new direct spawn appears anywhere outside `adapters/`
- it **passes on today's estate**, with the count in its output
- the `allowed` line carries the date and the number it replaces
- the failure names the files
- it covers **both packages** — `packages/board/src` and
  `packages/domain/src` outside `adapters/`
- it counts **all three doors**: process spawning, filesystem writes, and
  `fetch`/HTTP — with `packages/board/src/app/` excluded and the reason stated

**The trap:** counting matches in test files. Decide explicitly whether tests are
in scope and say why in the PR — 54 test files touch spawning, so including them
silently makes the number meaningless and excluding them silently hides a real
bypass.

Plus: `pnpm test`, and **the gate must pass on `main` unchanged** — run it there
before opening the PR.

### Scope guard

The gate. **Not the migration** — `production-calls` owns that, and its Spawning
slices will each take `allowed` down. This slice does not remove a single call
site.
