# Panel round 2 — a-slice-says-what-it-spent

Subject: `docs/plans/2026-09-15-a-slice-says-what-it-spent.md` (Draft, `Rounds: 3`)
Lenses: subject, locality, implementer. Reconciliation: **unanimous — amend**.
*(the subject juror's verdict arrived after this moderation was first written; its findings are folded in below and change nothing in the reconciliation)*
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

### The same population error, inside the amendment that fixed it

**Verified by the moderator.** The amended plan justifies its per-session rule
with *"604 session files, 421 of them `agent-*`"*. Measured:

```
~/.claude/projects/-Users-jwloka-Quatico-Agentic-Tools-plot/   604 files, 421 agent-*
```

**That is the master agent's directory — this session's own.** The real
population is **292 desk directories holding 1,757 `agent-*` files**, where the
subagent share is **13.78% of output tokens**, not the ~1% the plan states.

Round 1 caught the *timing* argument measuring the master agent's transcript. The
amendment corrected that paragraph — and then, writing the new *session*
argument in the same pass, **reached for the same directory again.** The rule is
right; every number supporting it describes someone else's directory.

### `HEAD` is a `gitBranch` value, and it is a fact about NO slice

**The finding that unpins the branch subject, verified by the moderator:**

```
worker session files                : 938
  containing a HEAD segment         :  44
  carrying NO real branch at all    :   4
```

Desks are cut **detached at `origin/main`**, and `reset_desk` passes through
detached between slices. So a `HEAD` segment is not a branch that ran — and the
juror measured one **in the middle of a slice**: 17 turns, 4,792,932 cache reads,
6,257 output, belonging to neither neighbour.

**Filter it and the run does not sum to the slice records. Charge it to a
neighbour and the record is wrong. Both are defensible — which is what an
unpinned subject means.**

**And the fixture cannot reach the real case.** The plan says a hopping worker
writes *"two"* records and demands a fixture with exactly two `gitBranch` values.
**The measured maximum is five, twice.** A conforming fixture never exercises
what occurs.

### The timing is now conservative rather than wrong

`subject` measures the largest worker transcript at **24–27 ms**, against the
plan's stated 90–250 ms. The plan errs safe, which is the right direction — but
it is the third number in this document that does not reproduce.

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
  **The panel is divided on whether this matters and the disagreement is named
  rather than averaged**: `implementer` treats it as a real omission, while
  `subject` measured `web_search_requests` and `web_fetch_requests` summing to
  **0 across the 15 largest worker transcripts** and would let it go. On this
  estate today the field is present on 69.5% of turns and bills nothing.

## Two claims in the plan that cannot both be true

`subject` found this and it goes to the plan's own reasoning:

- *"the transcript carries `gitBranch` per line, so the partition is readable"* —
  used to pin the **subject**.
- *"`seal_declaration` is the only moment that knows which branch just finished"*
  — used to pin the **timing**.

**If the first is true the second is false.** The real argument is probably that
the **session-to-slice mapping** becomes unrecoverable after a desk reset, not
the branch. That may well be right, and it is nowhere written down.

## The strongest argument against, sharpened

`implementer` puts it best: the plan withdrew the cost argument that justified **storing** over **deriving**, while itself proving `gitBranch` is in the transcript — which is what would make the after-the-fact derivation it rejects possible. The story's dated decision forbids a stored cost; the plan has not answered it, and has now removed its own best reason for overriding it.

`locality` adds the structural form: **a rollup over machine-local records is unsound.** Absences from other machines, reaped desks and SIGKILLed workers are each individually honest, and the sum over them is not.

## What this panel asks for

1. **Pin the path's RESOLUTION, not just its directory** — `--git-common-dir`, with a gate that a record written from a desk survives that desk's reap. Cite `.gitignore:30`.
2. **Name the session**: `$PLOT_SESSION_ID`, not the newest file.
3. **State the `gitBranch` rule**, including the `HEAD` turns, and put them in the fixture.
4. **Name the bound path** as uncovered, or cover it.
5. **Name the reader-side vocabulary.** `DeclarationReading` (`entities/declaration.ts:78-81`) is the settled precedent beside this record — declared/absent/unreadable, plus **elsewhere** for a run on another machine.
6. **Re-measure the session argument over worker desks** — 292 dirs, 1,757
   `agent-*` files, 13.78% — not the master agent's directory.
7. **Pin `HEAD`**: say which slice a detached segment belongs to, or that it
   belongs to none and the records deliberately do not sum to the run. Raise the
   fixture from two `gitBranch` values to five.
8. **Write down the real timing argument** — the session-to-slice mapping, not
   the branch.
9. Apply round 1's item 3 (`STORY:270`), still outstanding and named by all three
   jurors as the strongest objection.

**Close, and not dispatchable.** Three jurors agree the capture is worth doing
and the trap is well proven — `subject` recomputed the cache-read share at
exactly **99.36%** and calls it *"a demonstrated trap"* rather than a plausible
feature.

What is not yet earned is a record whose **path** nobody has pinned, whose
**session** is argued from the wrong directory, and whose **branch** has a third
value — `HEAD` — that belongs to no slice at all.

**`STORY-plot-plan-economics.md:270` remains the strongest objection**, and all
three jurors name it. The plan spends three paragraphs openly arguing against
`spend.ts`'s `output_tokens` rule — demonstrating it knows the standard — and
then never applies that standard to *"cost is derived, never stored"*, the dated
decision governing its entire mechanism.
