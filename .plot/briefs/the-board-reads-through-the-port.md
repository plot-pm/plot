## Implementation brief — the-read-path-stops-spawning (wave 1: Reading)

- **Plan (canonical):** `docs/plans/2026-08-31-the-read-path-stops-spawning.md` on `main`
- **Branch:** `feature/the-board-reads-through-the-port` (base: `main`)
- **Ends as:** one PR to `main`

**First of four, and it proves the pattern the other three follow.** `board.ts`
only — `fleet.ts`, `server-info.ts`, `agent-log.ts`, `registry.ts` and
`agent-panel.ts` belong to later waves.

### What to build

`board.ts`'s `git()` and `gitBuffer()` give way to the `Refs` port,
`buildBoard` becomes async, its route handler awaits it, and the static-git
cache is deleted.

### The measurement that licenses this, and the one that closes it

`sample <pid> 5` on a wedged board, main thread, **4258 of 4262 samples**:

```
uv_run → uv__io_poll → http_parser::on_headers_complete()
 → v8::Function::Call → (the request handler)
   → node::SyncProcessRunner::Spawn        ← execFileSync
```

**A synchronous spawn cannot yield.** A static file timed out at 15 s beside
it, which is the reading that separated this from every "the board is slow"
theory: a slow computation does not stop `/` being served, a blocked loop does.

Four other causes were named from reading the source and **all four were
refuted** — the plan tabulates them. Do not re-derive them, and do not add a
fifth from reading: the stack took five seconds and the source took days.

### The surface, measured 2026-08-31

| | |
|---|---|
| `board.ts` | **2134 lines** |
| `git()` / `gitBuffer()` call sites | **14** |
| `execFileSync` occurrences | **5** |
| `buildBoard` | **line 1454, currently sync** (`): Board {`) |
| static-git cache | **line 255**, `staticGitCache` + its `clearStaticGitCache()` test seam |
| the port | `packages/domain/src/ports/refs.ts` — already async, already returns `PortResult` |

**`git()` swallows every failure** (`catch { return '' }`), and `gitBuffer()`
returns `null`. The port returns `PortResult`, which does not. Translating an
error into `''` at each call site would preserve today's behaviour and throw
away the reason — decide per site whether an empty answer is legitimate, and say
so where it is.

### The caller the plan does not mention — check it first

`controllers/fleet-state.ts:108` calls `buildBoard(opts)`, and its own comment
at line 97 says **"Two full board builds per request, each doing its own"**.
Making `buildBoard` async ripples there, and that file is the `/api/fleet`
controller — wave 2's territory. Read it before you start: if the ripple cannot
be contained to an `await`, say so in the PR rather than reaching into wave 2's
files.

### The caches are DELETED, not kept

Both stopgaps shipped 2026-08-31 and both go: the static-git cache in `board.ts`
and the config cache (`packages/board/test/unit/config-cache.test.ts` is its
test — **delete the test with it**, the plan's fourth `Done when` says so
explicitly).

**Caching a synchronous function keeps it synchronous.** They bought
1.2 s → ~0.77 s without changing the signature, which is precisely why they are
not the fix. Do not add a new cache to recover a latency number: the plan's
third `Done when` exists because *"the tempting wrong fix for latency is a cache
that freezes content."*

### `ls-tree`, `for-each-ref`, `show`, `cat-file --batch` must stay live

They answer differently on every commit. Caching them would make the board show
an estate that no longer exists — the failure `plot-fleet-scan.sh` avoids by
re-deriving from git every pass.

### Arrow functions, and mind the blame

New functions are arrows (`export const f = (…) => …`). But **the unit is the
function, not the file**: `board.ts` is 2134 lines of `function` declarations
and converting the neighbours produces a diff with no behaviour change that
destroys `git blame`. If you are writing the body, it is an arrow; if you are
passing through, leave it.

### Done when

- A `sample` of the board under load shows **no `SyncProcessRunner::Spawn`
  below a read route's handler**, and the profile is recorded in the PR. This is
  the measurement that found the defect and the one that closes it — not a
  latency number, which contention can flatter or spoil.
- `/` answers in single-digit ms **while `/api/board` is in flight**, asserted
  back to back rather than on a timer.
- The board still shows a plan added since the last request — asserted.
- The static-git and config caches are gone, and their tests with them.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  `pnpm test`, changeset. Node 24 (`nvm use`), `corepack pnpm`.
- **Do not run `pnpm run test:e2e` locally** — it is CI's gate; it dispatched 53
  concurrent node processes on this machine and took the board down.

### Scope guard

`board.ts` and what its signature change forces. The write routes
(`idea.ts` 7 spawns, `deliver.ts` 3, `dispatch.ts` 3, …) are a later plan
entirely — they block only the operator who clicked, not every viewer.
