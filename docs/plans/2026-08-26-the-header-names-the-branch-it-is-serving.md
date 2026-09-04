# The header names the branch it is serving

> The Agents tab's *Master Agent* row shows the branch the board is serving,
> instead of rendering nothing where a fact belongs.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** 2026-08-28
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-26, Jan Wloka, `bug/the-header-names-its-branch`

## Changelog

- The Master Agent row names the branch again. `masterAgentBranch` returns empty
  inside the running server while its own derivation returns the branch when run
  standalone.

## Motivation

Reported by a reader on 2026-08-26: *"I wonder why the master agent's branch is
not shown?"*

`/api/fleet` reports `masterAgentBranch: ""`. It should report
`bug/a-head-counts-its-own-waves` — the branch the main checkout is on.

### Every step works in isolation

Measured 2026-08-26, running the server's own code standalone from the board's
own cwd:

```
git worktree list  → first line is the main checkout      ✓
/^(\S+)\s/ on it   → /Users/jwloka/Quatico/…/plot          ✓
git branch --show-current there → bug/a-head-counts…       ✓
```

And the surrounding facts:

- `PLOT_REPO_ROOT` unset, so `repoRoot` is the server's cwd — the directory the
  derivation was tested in
- the cache TTL is 5 s, far too short to explain a persistent empty
- the artifact is fresh and contains the call (`masterAgentBranch:hw(e.repoRoot)`)
- **a clean restart did not change it**

So the function returns empty *inside the process* and non-empty outside it, and
the difference has not been found. **That is the plan: find it.**

### What was ruled out, so nobody repeats it

- **Staleness** — a clean restart still reports `""`
- **A stale cache** — 5 s TTL
- **`PLOT_REPO_ROOT` pointing elsewhere** — unset
- **A stale artifact** — rebuilt, no diff, call present
- **The regex** — tested against the real `git worktree list` output
- **A detached board worktree** — it WAS detached, which is a real and separate
  problem now fixed (the worktree tracks `origin/main` as `board-main`), and
  fixing it did not fix this

## Design

### FOUND 2026-08-26: a dynamic `require` inside an ESM bundle

The cause is one line. `readMasterAgentBranch` (`fleet.ts:275`) reaches for
`child_process` at call time:

```ts
const { execFileSync } = require('node:child_process');
```

It is not the only one. `mainCheckoutPath` (`fleet.ts:239`) does the same
thing, and it runs FIRST — so it throws, returns `null`, and
`readMasterAgentBranch` never reaches the line above: `if (mainPath)` is false
and the function returns `''` without trying.

**The board artifact is an ESM bundle**, and `require` does not exist there. The
bundler emits a shim whose fallback is exactly this:

```js
function(e){ if (typeof require<"u") return require.apply(this,arguments);
             throw Error('Dynamic require of "'+e+'" is not supported') }
```

Reproduced verbatim against the shipped shim:

```
$ node -e '<the shim>; try { yd("node:child_process") } catch(e){ console.log(e.message) }'
Dynamic require of "node:child_process" is not supported
```

So the call throws **every time**, the bare `catch { branch = '' }` swallows it,
and the function returns `''` — indistinguishable from the detached-HEAD case it
was written to report.

### The sibling function three lines away does it correctly

The minified artifact shows both, side by side:

| function | how it gets `execFileSync` | result |
|---|---|---|
| `readMasterAgentBranch` | `yd("node:child_process")` — the **shim** | throws → `''` |
| the neighbouring reader | `zg(...)` — a **static import** | works |

One file, one bundle, two spellings of the same need. The static import is the
one that survives bundling.

### Why every earlier hypothesis was correct AND irrelevant

The ruled-out list was sound; it simply could not reach this, because the defect
is deterministic and environmental rather than stateful:

- **works standalone, empty in-process** — standalone runs had `require`
  available; the bundle does not
- **a clean restart changes nothing** — it never worked in the bundle, so there
  was no state to clear
- **the artifact "contains the call"** — it does. The call is present and always
  throws
- **cache TTL, `PLOT_REPO_ROOT`, the regex, the detached worktree** — all fine,
  and none of them are on the failing path

### The fix, and the thing that hid it

Replace the dynamic `require` with the static import the rest of the module
already uses.

**And narrow the `catch`.** A bare `catch { branch = '' }` turned a
`Dynamic require … is not supported` into *the main checkout is on a detached
HEAD* — a plausible, wrong, silent answer. That collapse is the reason a
one-line bug survived a full investigation that correctly eliminated five other
causes.

This is the same rule the estate keeps arriving at from different directions:
[[a-degraded-scan-says-why]] for the scan's `2>/dev/null`,
[[the-adapter-checks-the-cli-it-got]] for `bb`'s swallowed stderr. **A failure
that cannot be told apart from a legitimate empty answer will be read as the
empty answer.**

## Slices

### Found (Branch: bug/the-header-names-its-branch, PR: #459)

Instrument the derivation, reproduce the empty value inside the server, fix the
cause, and say in this plan what it was.


## Done when

1. **`/api/fleet` reports the main checkout's branch** where that checkout is on
   one. Asserted against the running board, not only against the function.
2. **`readMasterAgentBranch` uses a static import**, not a dynamic `require`.
   The artifact is ESM; the dynamic form throws on every call.
3. **A genuine detached HEAD still reports `''`**, and the renderer still shows
   no row. The empty answer was always correct for that case — it was being
   produced for the wrong reason.
4. **A failure to RUN git is distinguishable from a detached HEAD.** The bare
   `catch` is what let a bundling error read as a legitimate empty branch; the
   two must not collapse to the same value silently.
5. **BOTH dynamic `require` calls are fixed.** `fleet.ts` carries two —
   `mainCheckoutPath:239` and `readMasterAgentBranch:276` — and they are on the
   SAME path, not one live and one latent. `mainCheckoutPath` throws FIRST and
   returns `null`, so `readMasterAgentBranch` never reaches its own `require`:
   `if (mainPath)` is false and it returns `''`. Fixing only the second changes
   nothing at all.
6. `pnpm run test:board`, `pnpm run typecheck` green.
## Approval

- **Assignee:** Jan Wloka

## Notes

### Time spent before writing this

Roughly twenty minutes of live debugging, mid-sprint, with five hypotheses
eliminated and none confirmed. Recorded because the next person should start
from the instrumentation rather than re-running those five.

### Interrogated 2026-08-26 — and the round found the cause

This plan's whole design was *"instrument, then theorise"*, because the cause had
survived a careful investigation. The interrogation ran the instrumentation
instead of designing it, and the bug fell out in three steps:

1. `/api/fleet` **still** reported `""` after the board was restarted from a
   correctly-tracking worktree — killing the last standing hypothesis.
2. `AgentList.tsx:628` says an empty value *"means detached HEAD"*, and the main
   checkout is demonstrably on `bug/a-head-counts-its-own-waves`. So the empty
   was being produced for a reason the renderer does not know about.
3. `readMasterAgentBranch` calls `require('node:child_process')` **inside an ESM
   bundle**. Reproduced against the artifact's own shim: *Dynamic require of
   "node:child_process" is not supported*.

The plan can now be implemented rather than investigated: swap the dynamic
`require` for the static import, and narrow the `catch` that made a bundling
error look like a detached HEAD.

**The lesson is the `catch`, not the `require`.** Five hypotheses were correctly
eliminated and the sixth was unreachable, because the failure had been given the
same value as a legitimate answer. The estate has now met this three times in one
day — the scan's `2>/dev/null`, `bb`'s swallowed stderr, and this.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Does the bug still reproduce after the board was restarted from a tracking worktree?",
      "a": "Yes — /api/fleet still reports empty, which eliminates the last standing hypothesis",
      "category": "technical"
    },
    {
      "q": "Why does the derivation work standalone but not in-process?",
      "a": "readMasterAgentBranch uses a dynamic require inside an ESM bundle; the shim throws and a bare catch swallows it",
      "category": "technical"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": true, "architecture": true, "implementation": true },
    "domain": false,
    "ux": { "happyPath": false, "edgeCases": true, "errors": true, "accessibility": false },
    "nonFunctional": { "security": false, "performance": false, "scalability": false },
    "tradeOffs": false
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
