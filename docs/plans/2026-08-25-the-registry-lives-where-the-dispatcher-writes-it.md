# The registry lives where the dispatcher writes it

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-25, Jan Wloka, `feature/the-registry-directory-is-configured`
- **Started:** 2026-08-25, Jan Wloka, `bug/the-drop-writes-where-the-registry-reads`

## Changelog

The board reads the agent registry from one place whichever worktree it is
served from, so a board started outside the dispatcher's checkout still sees the
workers it dispatched.

## Motivation

### The measurement

Reported from a running board on 2026-08-25: an `unknown` agent row in WAITING
ON YOU wearing **no `⋯` at all** — the one row whose single available action was
the one it could not offer.

The proximate cause is a guard that is doing its job:

```ts
// No session = no manifest = nothing to drop.
if (!agent.session) return null;
```

And measured against `/api/fleet`: **all 12 agents had `session: ''`** — the
eleven live workers included.

### The cause is where the board was started, not a lost field

The first reading was that something drops `session` between the manifest and
the payload. That is **wrong**, and the correction is the useful part:

- `AgentEntrySchema` defaults `session` to `''` deliberately — *absent is a real
  state, not a rejection*.
- `registry.ts` REQUIRES a session when parsing a manifest (`if (session === '')
  return null`), so a manifest-backed entry always carries one.
- `synthesizeEntry` creates entries for worktrees the registry can see but has
  **no manifest for**, and it *"invents NOTHING it does not have"* — `session`
  is `''` by design, because the id is minted at launch and this worktree never
  had one.

So every one of those 12 rows was SYNTHESIZED. The registry had no manifests to
read at all:

```
.plot/agents/ in the main checkout          7 manifests
.plot/agents/ in the previous board tree   25 manifests
.plot/agents/ in the current board tree     0 manifests
```

**`.plot/agents/` is gitignored (`.gitignore:45`), so it is per-worktree**, and
`AGENT_MANIFEST_DIR` is the repo-relative constant `.plot/agents` — resolved
against whichever worktree serves the board. `plot-dispatch.sh` writes manifests
into the checkout it runs from; a board served from a different worktree reads
an empty directory and synthesizes the whole fleet from `git worktree list`.

### It is not a rare misconfiguration

This estate reproduced it twice in one hour, both times by ordinary acts:

1. The board ran for hours from `plot-wt-feature-the-sweep-reports-sprint-drift`
   — a dispatch worktree, which happened to hold 25 manifests.
2. Restarting it "properly" from a fresh `plot-board` worktree **caused** the
   defect, because the new tree had none.

A board's correctness currently depends on an invisible coincidence: whether the
directory it was started in is the one dispatch happened to write to. Nothing on
screen says which, and the failure is silent — the rows still render, they just
quietly lose their identity and their actions.

### What a synthesized fleet costs

- **No Drop, for any entry.** The manual reconciliation for entries the automatic
  resolver cannot clear is closed for every row.
- **Degraded row identity.** `AgentList` keys rows by
  `agent.session || branch || worktree`; with no session, two entries on one
  branch collide.
- **No transcript join.** The join keys on session, so those fields stay absent.

## Design

### One registry, named where the config already names things

The board resolves the manifest directory from a location that does not depend
on which worktree it was started in — read via `plot-config.sh`, the mechanism
this project already uses for every other adopting-project convention
(Principle 5: Plot hardcodes no project conventions).

The default keeps today's behaviour for the ordinary single-checkout case, so a
project that never uses worktrees sees no change.

### The board says which registry it read

Whatever the resolution, the board reports the directory and how many manifests
it found. **This is the half that makes the other half honest**: the failure
this plan fixes was invisible, and a fix that silently changes where the board
looks would replace one invisible behaviour with another.

A reader who sees `0 manifests` learns immediately that the fleet on screen is
synthesized — which is exactly what nobody could tell today.

### Not chosen: make `plot-board` a special case

Tempting — teach the board to look in the main checkout. Rejected: it hardcodes
this repo's layout into the tool, and it is wrong for a project whose dispatcher
runs somewhere else. The config key is the same answer without the assumption.

### Not chosen: stop gitignoring `.plot/agents/`

Committing manifests would make them shared, and they are machine-local facts —
pids, worktree paths, a session id. Sharing them across clones would put another
machine's pids in front of a reader as though they were theirs.

### Not chosen: fix the guard instead

`if (!agent.session) return null` is correct and stays. A menu offered without a
session would act on nothing or on the wrong entry. The row has no session
because the entry is synthesized; the fix belongs where the synthesis is
unnecessary.

## Waves

### Named (Branch: feature/the-registry-directory-is-configured, PR: #420)

The manifest directory is read through `plot-config.sh` with today's path as the
default, so a board served from any worktree finds the dispatcher's registry.

### Dropped (Branch: bug/the-drop-writes-where-the-registry-reads)

`drop.ts` resolves the manifest directory the same way the reader does, so the
Drop action removes the file the board is showing.

**Found after wave `Named` merged**, 2026-08-25: the read path now honours the
config key, but `drop.ts:85` and `drop.ts:187` still join the **constant**
`AGENT_MANIFEST_DIR`. Dropping four entries whose manifests demonstrably exist
returned `dropped=true` with `"no manifest found"` — the endpoint looked in the
board worktree while the files sat in the dispatcher's checkout.

A drop that reports success while removing nothing is worse than one that
refuses: the row returns on the next pulse and the operator has no way to tell
the action from a no-op.

### Counted (Branch: feature/the-board-says-which-registry-it-read)

The board reports the directory it read and how many manifests it found, so a
synthesized fleet is legible instead of silent.

## Done when

1. A board served from a worktree with no `.plot/agents/` of its own still reads
   the dispatcher's manifests, and its agents carry their session ids.
2. **A worktree that genuinely has no manifest still synthesizes an entry with
   `session: ''`.** The synthesis path is not removed — it is what makes a
   hand-made worktree visible at all. This is the assertion a naive
   implementation fails: pointing the reader elsewhere and deleting the fallback
   passes item 1 and makes undispatched worktrees vanish.
3. A broken agent WITH a session offers *Drop this agent*; dropping removes that
   manifest and the row disappears on the next pulse.
4. A broken agent with NO session still renders no menu — the guard is unchanged.
5. The board reports which manifest directory it read and how many entries it
   found, so a synthesized fleet is legible rather than silent.
6. A single-checkout project's behaviour is unchanged, asserted on a fixture with
   no config key set.
7. **Dropping an entry removes the manifest the reader found.** Asserted with
   the configured directory differing from the repo-relative default — the case
   that measured `dropped=true` over a file that still existed. Both call sites
   (`drop.ts:85`, `:187`) resolve the same way the reader does.
8. **A drop that removes nothing does not report success.** The endpoint
   distinguishes *there was no manifest* from *I looked in the wrong place*.
   This is the assertion the current behaviour fails: it answered `dropped=true`
   four times over four files that were still on disk.
9. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### The first diagnosis was wrong, and cheap to disprove

*The field is lost between the manifest and the payload* — three greps disproved
it: the schema defaults it deliberately, the parser rejects a manifest without
one, and the synthesizer documents leaving it empty. The bug was one directory
listing away, and the plan that named the wrong cause would have sent someone
looking through serialization code for a field nothing drops.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A board reading an empty registry
does not say so — it renders a plausible fleet with no identities and no
actions, and the reader has no way to tell that from a fleet that simply has
nothing to offer.
