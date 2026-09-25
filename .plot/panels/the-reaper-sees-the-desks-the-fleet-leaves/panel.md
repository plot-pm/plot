# Panel — the reaper sees the desks the fleet leaves

Subject: `docs/plans/2026-09-25-the-reaper-sees-the-desks-the-fleet-leaves.md` (`1931705b3`, 2026-09-25 09:42:50 +0200)
Convened: 2026-09-25 12:29–12:56, on `main` at `fd96869ba`
Lenses: estate, evidence, design, scope — four jurors, one rubric, persona varied only.

## Outcome: DIVIDED — 2 reject, 2 amend

| Lens | Position | Evidence |
|---|---|---|
| estate | **reject** | executed |
| design | **reject** | executed |
| evidence | **amend** | executed |
| scope | **amend** | executed |

All four gated: `Position` and `Evidence` both committed on every juror. No hedges.

## Where all four agree

The disagreement is about remedy, not fact. Every juror independently established the same three findings, and the moderator re-verified each.

**1. Slice 1 is already built, shipped, and running.** `unclassified-tree` is a first-class finding kind (`reconcile.ts:53`), emitted by `unclassifiedFindings` (`:436-454`) with `repair: ''`, rendered and counted by `plot-reconcile-scan.sh:2578-2584`. It shipped as **PR #878** on 2026-09-10, whose changelog entry is the plan's own thesis in the plan's own words.

Two jurors proved it by construction rather than by reading: each cut a pid-less worktree under `.worktrees/` and ran both readers. Both reported it — `unplaced=1` from the reaper, an `unclassified-tree` finding from the scan, neither carrying a removal command.

**2. Slice 2's premise is false, and the slice is unbuildable as written.** The plan's table asserts `plot-dispatch.sh --start` writes `.plot-worker.pid` "at creation". It does not. The desk is cut at `:2057`; the pid is written at `:1418` by the worker-launch wrapper, *after* `( cmd ) & agent=$!` — the agent process must exist first. `:1034` states it outright: *"the desk already exists by the time `start_worker` is called."*

So "every path that creates a desk writes `.plot-worker.pid`" has no honest value to write. All three options are harmful:
- an empty file — `plot-reap.sh:506` reads it as *no live worker*, making a never-started desk reapable
- a fabricated pid — a recycled number reads as a live worker on an empty desk
- the creator's pid — violates `plot-dispatch.sh:1178`'s capitalised contract, *"TWO PIDS, TWO NAMES"*, which is why `.plot-worker.wrapper.pid` exists separately

**3. The plan's central measurement no longer exists.** 16 worktrees / 10 unplaced is now 5 worktrees / 0 unplaced, all carrying markers. Both desks the plan names by hash are gone. The estate was cleared by an operator after the plan was written, so these are *not checkable* rather than *wrong* — but the plan's own Open Question ("why do two `free-*` desks have no pid?") can no longer be investigated, and it is the question the plan says decides slice 2's shape.

## Where they divide, and why

**The rejecters** (estate, design) hold that once slice 1 is built and slice 2 is unbuildable, nothing survives that resembles the plan. Design adds a fourth ground: `.plot-worker.pid` is the wrong carrier in principle — provenance is permanent and liveness is transient, and overloading one file with both is what produced the plan's unanswerable Open Question.

**The amenders** (evidence, scope) hold that a real, smaller defect remains and the plan is the right place to carry it. Scope found the sharpest version: exactly **one** live creator still makes an unrecognisable named desk — `plot-resolve-artifact.sh` — because dispatch's per-slice `worktree add` was deliberately removed (`plot-dispatch.sh:3626`) and `plot-worker-loop.sh` cuts `plot-wt-*`, which the reaper recognises by name.

Scope also found the one finding no other juror reached, and it is the most dangerous in the plan: **slice 2 would mark `plot-approve` and `plot-deliver` booking worktrees as reapable desks.** Those land under `.worktrees/` as `.plot-approve-<slug>.<pid>`; they are not desks and must never be judged as one. That is a widening of the removal population — precisely what the plan's line 66 promises not to do.

## The moderator's reading

**The division is narrower than the labels suggest.** No juror argues the plan should proceed as written; the split is whether what remains is a rewrite or a different plan. Both rejecters named work worth doing, and both amenders' lists begin by deleting the plan's premise.

What actually survives, on all four jurors' evidence:

- a **commit count and branch** on the existing `unclassified-tree` finding — a field, not a section
- a **footer key** splitting `desks=` into judged desks and unplaced trees — the `sprint_drift=57` shape the scan's own header records
- **`plot-resolve-artifact.sh`** naming its tree recognisably — one call site
- **booking worktrees excluded** from the unplaced population — not marked as desks

That is a coherent, useful plan. It is not this one: it shares no slice with what is written, its premise is the opposite of the plan's ("the reaper is silent" → "the reaper reports, and one creator and one exclusion are missing"), and its motivating measurement is gone.

**Recommendation: reject and re-draft**, carrying the four survivors into a new plan. This is the rejecters' position on the amenders' evidence, and it is what both amenders' correction lists amount to when applied in full.

## Findings beyond the plan

Three, each verified by the moderator:

1. **CLAUDE.md carries a wrong date and a stale line number.** Its §21 entry says *"measured 2026-09-09, ten finished desks while the reaper reported three"* and cites `plot-reap.sh:384`. The reaper's own header says **2026-09-10**, `978b9146d` (PR #878) landed 2026-09-10 15:52, the file contains no 09-09 anywhere, and the recognition test is now at `:467-470`. **The plan inherited both errors from CLAUDE.md** — which is how a drafting fault propagates from the estate's own documentation.

2. **The board symptom is untouched by this plan, and is real.** A worktree with no manifest synthesizes an agent row regardless of recognition — `.plot-worker.pid` appears nowhere in that predicate. The operator's *"1 manifest, 10 synthesized"* belongs to `the-registry-knows-which-agents-live`, which scope could not find as a plan file on this estate: the slug appears only as prose citations inside other plans.

3. **The plan's opening sentence contradicts its own line 67.** It opens with the board symptom and then states it does not change what the board synthesizes. Whatever replaces this plan should not open on a symptom it does not address.

## What the jurors did to the estate

Two created a probe worktree under `.worktrees/` to test the recognition path and removed it afterwards. `.worktrees/` holds the five `free-*` desks it held before. No juror edited any file but its own verdict.
