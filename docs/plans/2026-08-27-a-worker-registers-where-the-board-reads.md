# A worker registers where the board reads

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** 2026-08-28
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-28, Jan Wloka, `bug/an-unregistered-worker-does-not-start`

## Changelog

The dispatcher writes each agent's manifest where the board reads it, and a
worker whose manifest cannot be written does not start.

## Motivation

### The measurement

The board, 2026-08-27, with five workers running:

```
WORKING (5) — 2 manifests, 9 synthesized
```

Two of the five rows carried an agent identity (`6684267c`, `ec6daad0`); the
other three showed **branch names in the agent slot**, because the board had no
manifest for them and synthesized a row from the worktree alone.

Counted the same minute:

| directory | manifests |
|---|---|
| `plot/.plot/agents` — what `Agent registry` names, and what the board reads | **2** |
| `plot-board/.plot/agents` — read by nothing | **5** |

Every agent HAD a manifest. None of the five was missing one. They were written
to a directory nobody asks about.

### The split: writers follow cwd, the reader follows config

`readAgentRegistry` honours the `Agent registry` config key — that shipped in
#420 — and `resolveManifestDir` (`registry.ts:145`) resolves it correctly,
absolute or relative. `drop.ts:203` already routes through it.

The two writers do not:

- `plot-dispatch.sh:389` — `manifest_dir="$repo_root/.plot/agents"`
- `manifest-stamp.ts:136` — `const AGENT_MANIFEST_DIR = '.plot/agents'`

`repo_root` is `git rev-parse --show-toplevel` from the **dispatcher's own cwd**.
Auto-dispatch runs from the board's checkout (`dispatch.ts:428` passes
`cwd: opts.repoRoot`), so its manifests land there. The two that reached the
configured registry were written by hand-run `--restart` invocations from
`plot/`. **The count is not evidence about agents; it is evidence about which
directory each dispatcher was standing in.**

### Why this was hard to see

Six hypotheses were eliminated before the directory was checked: marketplace
cwd, a wrong `Agent registry` value, a stale checkout, `PLOT_REPO_ROOT`, path
normalisation, and `parseManifest` rejecting the files. All were wrong, and the
misleading clue was that manifests for **removed** worktrees did not appear as
`unknown` rows — which reads as the reader filtering them, and is instead the
reader never having seen any of them.

### The write cannot fail, which is why a rule would not hold

```bash
mkdir -p "$manifest_dir" 2>/dev/null || true
write_agent_manifest "$manifest_dir/$session.json" ... || true
```

Both `|| true`. A worker whose manifest could not be written starts anyway and
is invisible to the registry for its whole life. *Always write a manifest* is a
rule the code already believes it follows — and does. The enforceable condition
is not that a manifest exists; it is that **the manifest is where the reader
looks**, which is a fact only a check at the resolved path can establish.

## Design

### One writer already, and that is the good news

Four call sites spawn a process; only two create a Plot **agent**, and they are
already funnelled:

| site | spawns | manifest |
|---|---|---|
| `dispatch.ts:425` | `bash plot-dispatch.sh` | delegates — `start_worker` writes it |
| `plot-dispatch.sh` `start_worker` | the worker | **writes it** (all three entries: `--restart`, the two fan-out calls) |
| `continue.ts:522` | a continued worker | stamps an existing one |
| `idea.ts:737` | an idea-writing session in an idea worktree | none — see below |

So no new writer is added and no site is missed. The change is where the one
writer puts the file, and whether it may fail silently.

### `idea.ts` is deliberately out of scope

It spawns `claude` in an idea worktree to write a plan. It is not a branch
worker: it has no branch, no wave, and nothing in the fleet waits on it. Whether
idea sessions belong in the agent registry is a design question about what the
registry is FOR, and answering it inside a bug fix would settle it by accident.
Stated here so its absence is a decision rather than an oversight.

### Wave 1 — resolve the directory the same way the reader does

`start_worker` asks `plot-config.sh` for the `Agent registry` key, with
`.plot/agents` as the default, exactly as `readManifestDirConfig` does. Verified
2026-08-27: `plot-config.sh get "Agent registry" ".plot/agents"` returns the
absolute path from this repo's `CLAUDE.md`, so the shell needs no new mechanism —
and `start_worker` ALREADY calls `plot-config.sh` (line 332, for `Worker
command`), so not even the call shape is new.

**Copy `resolve_wt_root` (line 137), do not invent a second convention.** It
resolves `Worktree root` with exactly the case split this needs — absolute taken
as given, relative joined onto the repo root — and normalises away a trailing
slash so composed paths never double it, as pure string work because the
directory may not exist yet. Three details a fresh implementation gets wrong on
the first try, already settled one function away.

`manifest-stamp.ts` takes the same treatment: `manifestForWorktree` currently
joins `repoRoot` with the hardcoded constant, so it must route through
`resolveManifestDir`. It has **one caller** (`continue.ts:560`), which already
holds `opts` — the shape `resolveManifestDir` wants.

**The resolved path reaches the wrapper for free.** It already travels as
`PLOT_MANIFEST_FILE` (line 469) so the detached `sh -c` can stamp the agent's
pid into it. Wave 1 changes what that variable holds and nothing else — no new
plumbing, and the wrapper's tolerant `if [ -f "$PLOT_MANIFEST_FILE" ]` stays
tolerant, since by then the gate has already established the file exists.

**A relative default must keep working.** A project that never declares the key
gets `.plot/agents` under its own root, and a single-checkout project sees no
change at all. `resolveManifestDir` already handles both, which is why it is the
resolver rather than a second implementation.

### Wave 2 — the gate

**Before the spawn**, assert the manifest exists at the resolved path. If it
does not, no worker is launched and the dispatch reports why.

**Before, not after — and the ordering is the whole design.** The manifest is
written at line 394 and the worker spawns at line 469, 75 lines later, because
there is a spawn-to-first-write window a scan must not misread as an absent
agent. So the check has a launch to prevent rather than a process to kill: no
race, no kill path, and no chance of orphaning a worker whose manifest failed.
An earlier draft of this plan said *assert after launch, then kill* — that would
have built a kill path for a state that cannot arise.

**The gate is what makes this stay fixed.** Wave 1 alone corrects today's paths;
nothing then stops a future edit from reintroducing a directory the reader does
not read, and the symptom — rows that render, just without identity — is quiet
enough to survive for weeks. It already did.

**Refuse rather than launch.** An agent outside the registry cannot be seen,
stopped, restarted or reaped through the board; it holds a claim nobody can
release. A worker that cannot be registered is worse than one that never
started, because the second state is visible — and the worktree and claim remain
on disk either way, so the operator can retry once the cause is fixed.

### Not chosen: make the board read both directories

It would show today's five agents immediately and require no dispatcher change.
Rejected: it makes `Agent registry` advisory, so the config key stops meaning
anything, and every future reader must know the second location too. Two sources
of truth is the shape this repo keeps removing.

### Not chosen: have the board pass its registry path to the dispatcher

`dispatch.ts` could pass `--manifest-dir`. Rejected: the dispatcher is also run
by hand and by `--restart`, so the answer would depend on who invoked it — the
disagreement this plan exists to end. The config key is the one answer.

### Not chosen: keep `|| true` and only log

A logged failure in a detached worker's log is not read until someone goes
looking, which is the same invisibility with an audit trail.

### The tolerance in `continue.ts` must survive

`continue.ts:557` documents it: *"A missing manifest is not a failure — an older
worktree has none, and the worker runs regardless."* That is about **continuing**
a worker in a worktree predating manifests, and it stays true. The gate belongs
to CREATION, where the dispatcher has just minted a session id and there is no
older-worktree case to tolerate. Conflating them would make `/api/continue`
refuse worktrees it currently serves.

## Slices

### Resolved

- `bug/the-manifest-lands-where-it-is-read` — `start_worker` and `manifestForWorktree` resolve the manifest directory through the `Agent registry` key instead of the dispatcher's cwd. Tests: a dispatcher run from another checkout writes into the configured registry; a project with no key keeps `.plot/agents` under its own root; an absolute value is honoured as given; `manifest-stamp-parity.test.ts` still passes → #488

### Gated

- `bug/an-unregistered-worker-does-not-start` — the manifest is asserted at the resolved path BEFORE the spawn, and a branch whose manifest cannot be written is not launched. Tests: a write failure spawns no worker at all and names the path it could not write; the ordinary path is unaffected and reports nothing; `/api/continue`'s tolerance of a manifest-less older worktree is unchanged → #496

## Done when

1. **A dispatch run from a different checkout writes into the configured
   registry.** The measured case: auto-dispatch from `plot-board/` producing
   manifests the board cannot read. Asserted with an explicit cwd, not by
   running from the repo root — a test that runs where the config points passes
   without the fix.
2. **A project that declares no `Agent registry` key is unchanged**, writing
   `.plot/agents` under its own root. The regression this fix invites, and the
   shape most adopting projects have.
3. **An absolute configured value is honoured as given**, not joined onto a
   root. This repo's own value is absolute.
4. **The board renders an agent identity for every live worker** — the
   `N manifests, M synthesized` line reads `5 manifests, 0 synthesized` for
   five dispatched workers, where it read `2 manifests, 9 synthesized`.
5. **A worker whose manifest cannot be written is never launched.** Asserted by
   making the write fail (an unwritable directory), then checking that **no
   worker process was ever spawned** — not that one started and died — and that
   the dispatch names the path it could not write. The distinction is the fix:
   the manifest is written 75 lines before the spawn, so the correct gate
   prevents a launch rather than killing one.
6. **The ordinary path reports nothing new.** A fix that prints a warning on
   every successful dispatch trains readers to skip the line — item 5's message
   is only useful if it is rare.
7. **`/api/continue` still serves a worktree with no manifest.** The documented
   tolerance at `continue.ts:557`; the gate is about creation, not continuation,
   and a gate that spreads to continuation breaks working behaviour.
8. **`manifest-stamp-parity.test.ts` still passes.** The awk in
   `plot-dispatch.sh` and `stampManifest` must keep writing identical manifests;
   changing the directory in one and not the other splits them.
9. `pnpm run validate`, `pnpm run test:board`, `pnpm run test:reconcile` green;
   artifact rebuilt and committed.

## Notes

Found by an operator reading the board's own counter and asking how five agents
could have two manifests. The counter was right; the inference that agents were
being created without manifests was the natural reading and the wrong one — the
writers were never skipping the file, only putting it somewhere unread.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Can start_worker reach plot-config.sh?", "a": "Yes — it already calls it at line 332 for Worker command", "category": "technical"},
    {"q": "Is there a precedent for resolving a configured directory?", "a": "resolve_wt_root (line 137) does absolute/relative split plus trailing-slash normalisation", "category": "technical"},
    {"q": "What does plot-config.sh return for an absent key?", "a": "The supplied default, verified", "category": "technical"},
    {"q": "Where does the gate belong relative to the spawn?", "a": "BEFORE — write is line 394, spawn line 469; no kill path needed", "category": "technical"},
    {"q": "Does the resolved path need new plumbing to reach the wrapper?", "a": "No — it already travels as PLOT_MANIFEST_FILE", "category": "technical"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
