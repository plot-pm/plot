## Implementation brief — a-worker-registers-where-the-board-reads (wave: Gated)

- **Plan (canonical):** `docs/plans/2026-08-27-a-worker-registers-where-the-board-reads.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/an-unregistered-worker-does-not-start` (base: `main`)
- **Ends as:** one PR to `main`

**Wave 2 of 2.** `Resolved` shipped as **#488** — both writers now resolve the
manifest directory through the `Agent registry` key. This wave adds the gate.

### What to build

`start_worker` writes the manifest, then launches. Both writes are `|| true`:

```bash
mkdir -p "$manifest_dir" 2>/dev/null || true
write_agent_manifest "$manifest_dir/$session.json" ... || true
```

So a worker whose manifest could not be written starts anyway and is invisible
to the registry for its whole life. Assert the file exists at the resolved path
and refuse to launch without it.

### The decisions the plan settles — do not re-derive them

**BEFORE the spawn, not after.** The manifest is written at line ~394 and the
worker spawns at ~469 — **75 lines apart**, deliberately, because there is a
spawn-to-first-write window a scan must not misread as an absent agent. So the
gate has a launch to PREVENT, not a process to kill: no race, no kill path, no
orphan risk.

An earlier draft of this plan said *assert after launch, then kill*. It was
corrected during interrogation, and Done-when item 5 pins the difference — it
asserts **no worker was ever spawned**, not that one started and died. If you
find yourself writing a `kill`, you are building the rejected design.

**Refuse rather than launch.** An agent outside the registry cannot be seen,
stopped, restarted or reaped through the board, and it holds a claim nobody can
release. A worker that cannot be registered is worse than one that never
started, because the second state is visible. The worktree and claim remain on
disk either way, so the operator can retry once the cause is fixed.

**A rule is not a gate.** "Always write a manifest" is what the code already
believed it was doing — and it was; the file was simply unreachable (#488). The
enforceable condition is *the manifest is where the reader looks*, which only a
check at the resolved path can establish.

**`/api/continue`'s tolerance is NOT this gate.** `continue.ts:557` documents
it: *"A missing manifest is not a failure — an older worktree has none, and the
worker runs regardless."* That is about CONTINUING a worker in a pre-manifest
worktree and stays true. This gate belongs to CREATION, where the dispatcher has
just minted a session id and there is no older-worktree case to tolerate.
Conflating them makes `/api/continue` refuse worktrees it serves today — item 7.

### Done when

The plan's `## Done when` list is the specification. This wave owns 5, 6 and 7:

- **Item 5** — a worker whose manifest cannot be written **is never launched**.
  Assert by making the write fail (an unwritable directory) and checking **no
  worker process was ever spawned**, plus that the dispatch names the path it
  could not write.
- **Item 6** — the ordinary path reports **nothing new**. A fix that prints a
  warning on every successful dispatch trains readers to skip the line, and
  item 5's message is only useful if it is rare.
- **Item 7** — `/api/continue` still serves a worktree with no manifest.

Plus the repo's gates: `pnpm run validate`, `pnpm run test:reconcile` green; a
changeset with a `bumps:` block naming `plot` (a `skills/plot/` change, NOT
package frontmatter); Node 24 (`nvm use`, and `corepack pnpm`); `trash` not `rm`.

**Do not run `pnpm run test:board`.** Operator rule: a UI test must never start
the real board. This branch does not need it.

### Bookkeeping

Annotate this branch's line in the plan's `## Branches` section on main with a
trailing `→ #N`. This plan uses the **Branches** dialect. Check
`git branch --show-current` is main first, or use a detached scratch worktree.

### Scope guard

This branch owns `start_worker` in `skills/plot/scripts/plot-dispatch.sh` and
its tests. It does not change where the manifest goes — that was #488.
