# The reaper sees the desks the fleet leaves

> Ten worktrees under the configured root are `unplaced` — the reaper cannot classify them, so they are neither reaped nor kept nor counted. The board synthesizes a row for each, and an operator reads twelve broken agents where there are two healthy ones.

## Status

- **State:** Rejected
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `plot-reap.sh` recognises a dispatch desk by what created it rather than by one creator's marker, so the fleet's own leftovers are classified instead of skipped. Measured 2026-09-25: of 16 worktrees under `.worktrees/`, **10 were `unplaced`** — every one a real Plot desk, none removable and none reported as anything.

Board impact: **yes, and it is the visible symptom.** The board synthesizes an agent row per worktree with no manifest, so unplaced desks render as agents. The operator's reading — *"1 manifest, 10 synthesized"* — is this defect seen from the UI.

## Motivation

**An unplaced desk is invisible to every decision and visible in the one place it misleads.**

`plot-reap.sh:415` records the intent — a tree is a desk by its `.plot-worker.pid` file or its legacy `plot-wt-` path — and anything else falls through. The reaper's own header already names the cost of that silence, measured 2026-09-09: *ten finished desks while the reaper reported three.*

**Today it is ten again**, and the population is not stale history: three were created this morning.

## Design

### What was measured, 2026-09-25

```
worktrees under .worktrees/     16
  carrying .plot-worker.pid      6   ← all named free-*
  carrying no pid file          10   ← all named bug-*, feature-*, infra-*, or a slug
reaper verdict                   3 reapable, 4 kept, 9 unplaced
```

**The split is exact and it names the cause.** Every `free-*` desk carries the marker; no named desk does.

| Creator | Desk name | Writes `.plot-worker.pid`? |
|---|---|---|
| `plot-dispatch.sh --start` | `free-<hash>` | **yes**, at creation |
| the other `worktree add` paths | `<type>-<slug>` | **no** |

`grep -l 'worktree add'` finds six scripts; `grep -l 'plot-worker.pid'` finds a different set. **The recognition test is keyed to one of the two doors a desk comes in by**, so a tree made through the other is not malformed — it is unrecognised.

Two `free-*` desks (`free-0f3f1d2f`, `free-7330dc2a`) carry no pid either, so the marker is also **lost** over a desk's life, not merely never written.

### Why widening recognition is the risky half

The obvious fix — treat any tree under `Worktree root` as a desk — trades a safe refusal for a wider blast radius, and the reaper refuses exactly that today:

> a person's tree must never become an instruction to remove it, and `test -d .plot` cannot separate them because the repo tracks `.plot/` so every worktree has one.

**A hand-made checkout under `.worktrees/` is indistinguishable from a dispatch desk by location alone.** So recognition must key on something the fleet writes and a person does not.

### The shape of the fix, in the safe order

**Slice 1 — report the population.** The scan gains a finding naming trees under the configured root that no recognition test places, with their branch and commit count and **no removal command**. That costs nothing, ends the silence, and is correct whether or not the recognition rule ever widens. `plot-reconcile-scan.sh` §21 already reports desks this way and explicitly carries no `git worktree remove` for the same reason.

**Slice 2 — make the marker reliable.** Every path that creates a desk writes `.plot-worker.pid`, and the reaper's existing test then places them. This is the fix that *narrows* the unplaced population rather than widening what may be removed, so it changes no refusal.

**Slice 3 is deliberately absent.** Whether an unrecognised tree may ever be removed automatically stays a person's call, and this plan does not propose it.

### What this does NOT do

- **It does not remove anything new.** The reaper's five refusals stand untouched; slice 2 gives them more desks to judge, and every judgement is the one they already make.
- **It does not change what the board synthesizes.** A worktree with no manifest still produces a row — that is `the-registry-knows-which-agents-live`'s subject, and it is correct behaviour for an unmanifested desk.
- **It does not delete a lost marker's desk.** `free-0f3f1d2f` and `free-7330dc2a` lost their pid files; slice 1 reports them and a person decides.
- **It does not touch `reap()`'s rule in the domain.** The defect is which trees reach it.

### Open Questions

- [ ] **Why do two `free-*` desks have no pid file?** Created without one, or lost it? The answer decides whether slice 2 must also make the marker durable, or only universal.

### Done when

- The reconcile scan names every tree under `Worktree root` that no recognition test places, with its branch and commit count, and offers no removal command.
- Every desk-creating path writes `.plot-worker.pid`, and a test asserts it for each.
- **The unplaced count on this estate falls to zero for newly created desks**, measured before and after.
- **No refusal is relaxed**, and a hand-made checkout under the root is still reported rather than removed — the regression this must not cause.

## Slices

### The scan reports an unplaced desk (Branch: bug/the-scan-reports-an-unplaced-desk)

- `bug/the-scan-reports-an-unplaced-desk` — a reconcile finding naming trees under the configured root that no recognition test places, with branch and commit count, carrying no removal command; a machine-countable footer key beside the existing ones

### Every desk carries its marker (Branch: bug/every-desk-carries-its-marker)

- `bug/every-desk-carries-its-marker` — each path that creates a worktree under `Worktree root` writes `.plot-worker.pid` at creation, so the reaper's existing test places it; a test per creator; the unplaced count measured before and after

## Notes

- **Panelled 2026-09-25: `divided` — 2 reject (estate, design), 2 amend (evidence, scope).** All four committed `Evidence: executed`, and all four established the same facts; the split is about remedy, not evidence. **Slice 1 already ships** as PR #878 (2026-09-10) — `unclassified-tree` is a finding kind in `reconcile.ts:53`, emitted by `unclassifiedFindings` at `:436-454` with `repair: ''`, rendered by `plot-reconcile-scan.sh:2578-2584`; two jurors proved it by cutting a pid-less worktree and watching both readers name it. **Slice 2's premise is false**: no creation path writes `.plot-worker.pid` — the worker-launch wrapper writes it at `plot-dispatch.sh:1418`, after the agent process exists, and `:1034` says the desk already exists by then. So the slice has no honest value to write, and an empty file would make a never-started desk reapable. The scope lens added the finding nobody else reached: slice 2 would mark `plot-approve` and `plot-deliver` **booking worktrees** as reapable desks, widening the removal population this plan's own line 66 promises not to touch. **The measurement is also gone** — 16 worktrees / 10 unplaced now reads 5 / 0, and both desks named by hash no longer exist, so the plan's Open Question can no longer be investigated. Moderation: `.plot/panels/the-reaper-sees-the-desks-the-fleet-leaves/panel.md`.
- **What survives the panel, and it is a different plan:** a commit count and branch on the existing `unclassified-tree` finding; a footer key splitting `desks=` into judged desks and unplaced trees; `plot-resolve-artifact.sh` naming its tree recognisably (the one live creator that still does not); and booking worktrees excluded from the unplaced population rather than marked as desks.
- **The panel corrected CLAUDE.md, which is where this plan's error came from.** Its §21 entry said *"measured 2026-09-09"* and cited `plot-reap.sh:384`; the reaper's header says 2026-09-10, PR #878 landed that day, and the recognition test is at `:467-470`. Fixed on main in `75bf077ff` — the plan inherited both errors from the estate's own documentation.

- Found by an operator reading *"1 manifest, 10 synthesized"* on the board and asking whether the registry should reap abandoned desks. **It already checks every 60 s** — `reap`, `correct`, `person`, `defer` are tick counters — and `--start-agents` already keeps the agent count up. The gap is not the cadence; it is that ten desks never reach the rule.
- **The reaper's silence is the estate's own recorded defect, recurring.** Its header measured *"ten finished desks while the reaper reported three"* on 2026-09-09, and the fix then was to report the unclassifiable rather than widen removal. This plan applies the same remedy to the same shape, one layer out.
