# Panel round 2 — a-slice-says-what-it-spent

Subject: `docs/plans/2026-09-15-a-slice-says-what-it-spent.md` (Draft, `Rounds: 3`)
Lenses: subject, locality, implementer. Reconciliation: **unanimous — amend**.
Round 1's moderation is in `panel.md`; these jurors judged the amended text.

## What the amendment got right, and it is most of it

All three jurors credit the same two things, independently:

- **Both subjects are now NAMED.** Per slice at `seal_declaration`, per session never per worktree. Round 1's decisive finding is addressed in the plan's own voice.
- **The cost argument was withdrawn and replaced with the subject argument.** `implementer` calls the withdrawal *"exemplary"*; `locality` calls it *"the amendment's best work"*. The plan retired its own false measurement rather than defending it.

**The central trap reproduces.** `implementer` measured cache-read at **98.73%** of a naive four-counter total on a real worker transcript. The refusal of a summed fifth field is demonstrated, not argued.

## Named is not pinned — and that is the whole finding

Two jurors reached this independently. **The plan names both subjects and states a rule for neither**, so an implementer must invent one.

### Whose branch: `gitBranch` is not stable within one slice

`implementer` measured a transcript reading `gitBranch: "HEAD"` for **20 of 214 turns**, sequence `branch → HEAD → branch` — an agent detaching to baseline against main, **this repo's own recommended practice**. The obvious `=== $PLOT_BRANCH` filter silently under-reports ~9% with every gate green, and the demanded two-`gitBranch` fixture does not contain this case.

### Whose session: the answer exists and is unwritten

One desk directory holds **9 files, 6 of them `agent-*`, and THREE non-agent main sessions** (262 / 26 / 1 turns). The plan says *per session* and never says **which**. `$PLOT_SESSION_ID` is exported and in scope at the write site — that is the answer, and the plan does not give it. The demanded fixture (one main session beside subagents) passes while production picks one of three by mtime, which is exactly what `spend.ts:48-50` forbids.

## The decisive new finding: the record's PATH is unpinned, and the desk eats it

**`locality`'s finding, verified by the moderator directly.**

Every existing writer resolves `.plot/state/` with `git rev-parse --show-toplevel` (`plot-state-receipt.sh:68,84,159`; `plot-commit-record.sh:128`). **In a linked worktree that returns the WORKTREE.** Measured on this machine:

```
dispatch desks under .worktrees/ : 8
desks holding a .plot/state/     : 0
rev-parse --show-toplevel in a desk → …/.worktrees/feature-one-monitor-watches-the-slice
```

And `plot-reap.sh:624` runs `git worktree remove --force`.

**So the obvious implementation passes every one of the nine gates and the record is destroyed by the reap, on the machine that measured it.** The board, reading from the main checkout, finds nothing for every slice and correctly reports *"not measured here"* — **the honesty gate passing while reporting the opposite of the truth.**

**The repo already solved this and the plan cites neither problem nor fix:** `plot-install-commit-record.sh:42-43` uses `--git-common-dir` precisely so *"every dispatch worktree is covered by one install"*.

**And the plan cites the wrong `.gitignore` line.** It quotes `:35` — `**/.plot/state/`, whose own comment says it catches **nested fixture** dirs. The root pattern is `:30`. The plan quotes the line that describes this failure as if it supported the opposite.

## The write site does not run on the expensive path

`implementer` found this and it is not in round 1. `plot-worker-loop.sh:1000-1007` states it:

> *"A worker killed by the Worker bound or ended by the WorkerMonitor exits above without reaching this line."*

**So the runs that cost the most — the ones hitting the 28800 s bound — record nothing.** The plan's *"records nothing and says so"* gate is about an **unreadable transcript**, not an unreached write site. Open Question 2 calls the exits question mis-posed; it is not mis-posed, it is **unanswered**, and the plan closed it.

## What the lenses had in common — the shared blind spot

**All three verified the quotations and none re-derived the population figures.** The plan states 1,966 worker transcript files; `locality` reconstructs 1,144 or 747 depending on the filter, `implementer` measures **747**. The median matches closely (7,025 vs 7,084) and the conclusion survives — but the stated N does not reproduce, **and this plan has now measured the wrong population once and stated an unreproducible one twice.** The filter is named in prose rather than by a predicate, which is why nobody can check it.

## Two round-1 amendments were never applied

Verified by grep, by two jurors:

- **`STORY-plot-plan-economics.md:270`** — *"Cost is derived, never stored — a stored cost is a record that can be wrong"* — **still unmentioned.** Round 1 called this *"inconsistent with the plan's own standard"*, since the plan does exactly this work for `spend.ts`'s `output_tokens` rule. Unchanged.
- **`server_tool_use`** — **zero mentions.** `usage` carries **11 keys, not 4**.

## The strongest argument against, sharpened

`implementer` puts it best: the plan withdrew the cost argument that justified **storing** over **deriving**, while itself proving `gitBranch` is in the transcript — which is what would make the after-the-fact derivation it rejects possible. The story's dated decision forbids a stored cost; the plan has not answered it, and has now removed its own best reason for overriding it.

`locality` adds the structural form: **a rollup over machine-local records is unsound.** Absences from other machines, reaped desks and SIGKILLed workers are each individually honest, and the sum over them is not.

## What this panel asks for

1. **Pin the path's RESOLUTION, not just its directory** — `--git-common-dir`, with a gate that a record written from a desk survives that desk's reap. Cite `.gitignore:30`.
2. **Name the session**: `$PLOT_SESSION_ID`, not the newest file.
3. **State the `gitBranch` rule**, including the `HEAD` turns, and put them in the fixture.
4. **Name the bound path** as uncovered, or cover it.
5. **Name the reader-side vocabulary.** `DeclarationReading` (`entities/declaration.ts:78-81`) is the settled precedent beside this record — declared/absent/unreadable, plus **elsewhere** for a run on another machine.
6. Apply round 1's items 3 and 4, still outstanding.

**Close, and not dispatchable.** Three jurors agree the capture is worth doing and the trap is well proven. What is not yet earned is a record whose path nobody has pinned.
