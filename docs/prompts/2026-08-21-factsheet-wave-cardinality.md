# Prompt: correct the wave definition in the ref cards

**For:** whoever maintains `~/Documents (Work)/Ref Cards/agentic-development-with-plot/`
**Decided:** 2026-08-21 · **Authority:** `skills/plot/MANIFESTO.md` line 35

---

## The change

A wave carries **exactly one branch**. The cards currently define it as a
*group* of branches, with parallelism living inside the wave. Parallelism lives
**between** waves.

`plot-dispatch` gives every branch its own worktree and its own worker, so a
wave holding three branches is three desks and three agents under one heading
that names one slice of work — and the wave's completion, which is what opens
the next wave, then means three different things. Measured on the Plot repo the
same day: **49 of 57 waves already held exactly one branch**; the eight that did
not are a repair case (`docs/plans/2026-08-21-a-wave-is-one-branch.md`), not the
design.

`MANIFESTO.md` has been corrected and carries the note. The cards have not.

## What to change

**Two HTML files** (and their PDFs, which are regenerated from them):

`ein-team-ein-plan-viele-agenten-de.html`

1. **Glossar, Eintrag «Welle»** — currently:
   > Branches, die gleichzeitig laufen dürfen. Eine Welle öffnet erst, wenn
   > jeder Branch aller früheren Wellen gemerged ist.

   The second sentence is correct and stays. The first defines a wave as a
   group and has to go. Suggested:
   > Ein Branch mit eigenem Worktree — die Einheit, in die ein Plan geschnitten
   > wird. Eine Welle öffnet erst, wenn jeder Branch aller früheren Wellen
   > gemerged ist.

2. **Diagramm-Label** `WELLE 2 — PARALLEL, JE EIN WORKTREE` — the label is
   right that worktrees are one per branch, but it sits over several branches
   inside one wave. Either draw `WELLE 2` and `WELLE 3` side by side as the
   parallel pair, or relabel to say the waves run in parallel, not the branches
   within one.

`one-team-one-plan-many-agents-en.html`

3. **Glossary, entry "Wave"** — currently:
   > Branches that may run at the same time. A wave opens only once every branch
   > of every earlier wave is merged.

   Same treatment: keep the second sentence, replace the first. Suggested:
   > One branch with its own worktree — the unit a plan is cut into. A wave opens
   > only once every branch of every earlier wave is merged.

4. **Diagram label** `WAVE 2 — PARALLEL, ONE WORKTREE EACH` — same as (2).

## What must NOT change

- **The waiting table.** `Welle · fährt auf einem Branch mit Pull Request und
  eigenem Worktree auf` is already correct and is now singular by construction.
  Its subject/vehicle split is the argument the Plot board was rebuilt on the
  same day — do not touch it.
- **The spike section.** *"Ein Spike ist keine neue Sache. Er ist eine Welle"*
  and *"Eine Welle heisst: nichts zu parallelisieren, der Plan läuft
  blockierend"* — the second sentence is already the one-branch reading and gets
  stronger, not weaker.
- **`WELLE 2 ÖFFNET ERST, WENN WELLE 1 GEMERGED IST`** — correct as it stands.
- The `-abstract.de.md` / `-abstract.en.md` files: checked, no wave definition
  in either.

## Check when done

Grep both HTML files for `gleichzeitig laufen dürfen` and `may run at the same
time`. Zero hits in a wave definition. The phrase may legitimately survive where
it describes *waves* running at the same time — that is the corrected model, not
the old one.
