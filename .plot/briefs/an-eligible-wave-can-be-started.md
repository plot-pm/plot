## Implementation brief — an-eligible-wave-can-be-started (wave: Worded)

- **Plan (canonical):** `docs/plans/2026-08-27-an-eligible-wave-can-be-started.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/an-eligible-wave-can-be-started` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

**This is wave 1 of 2, and it depends on nothing.** Wave 2 (`Taken`) handles the
claimed case and waits on a different plan's wave — do not build it here, and do
not reach for the claim fact: it is not in the pulse yet.

### What to build

`plot-fleet-scan.sh` reports a wave as `eligible` when no earlier wave blocks it.
Readers take that to mean *I can start this*. Those coincide only for an approved
plan, and right now they mostly do not.

Measured 2026-08-27 — every one-wave plan in `not-started`:

| plan | verdict | phase |
|---|---|---|
| a-ticket-becomes-a-plan-or-a-story | eligible | **Draft** |
| a-dead-fetch-is-not-a-slow-one | eligible | **Draft** |
| a-reaped-worktree-takes-its-manifest | eligible | **Draft** |
| the-board-says-how-old-its-plans-are | eligible | **Draft** |
| a-stopped-worker-can-be-restarted | eligible | **Draft** |
| an-eligible-wave-can-be-started | eligible | **Draft** |

**Six of six unstartable.** `plot-dispatch.sh:424` refuses every one of them:
*"plan '<slug>' is still Draft on <ref> — nothing may be dispatched."*

Your job: a wave whose plan is not approved must not wear the word a reader acts
on. It gets its own word, because the reader's next action is different —
approve the plan, not start the work.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The fix is in the SCAN, not the board.** `plot-fleet-scan.sh:2821` is where the
verdict is defined:

```bash
elif [ "$prior_ok" -eq 1 ]; then verdict="eligible"
```

Tempting to suppress the word client-side instead — `fleet.ts` already has
`DRAFT_PLAN_NOTE` and routes Draft rows to `waiting-on-you`. Rejected: `--next`
and `plot-dispatch.sh` consume the same verdict, and a word meaning one thing to
the board and another to the dispatcher is the disagreement this plan removes
rather than relocates.

**The scan already reads the phase.** It parses it for the terminal grouping, so
the fact is in hand where the verdict is computed. **No new file read, no host
call** — `Done when` item 7 asserts this via the existing no-network test.

**Do NOT call it `blocked`.** That word already means *an earlier wave has not
landed* — a fact about ordering that resolves by merging work. A Draft plan
resolves by a person approving it. Folding both into one word rebuilds the
ambiguity one level down, and `blocked by Shaped — 1 branch` becomes a sentence
the row cannot truthfully complete. Item 5 asserts the rendered string is not
`blocked`.

**Do not move the badge.** The first report read as a placement bug — that
`eligible` belonged on the wave row rather than the plan row. It does not: a
one-wave plan deliberately splits its wave, the plan row carrying the VERDICT and
the wave row the NAME (`AgentList.tsx:1298`: *"the verdict migrated to the plan
row, the name did not"*). The word being wrong is what made its position look
wrong; moving it preserves the defect in a new location.

**Leave the startability PHRASE alone.** `PlanStartabilitySchema` carries
`someone is on it` — prose on a plan head, a different surface from a wave's
verdict word. Item 6.

**Leave `not-started` alone.** The section heading is about WORK: a wave with no
merged branch has not started, which stays true of all six. The verdict inside
the row is what says whether a reader can act. No section routing changes — keep
the diff on the word.

**Wave 2 is not yours.** A wave whose branch is already claimed also wrongly
reads `eligible` (measured: an Approved plan with a live worker on it). That is
the `Taken` wave, and it depends on `a-claimed-branch-is-not-startable`'s `Seen`
wave publishing the claim fact into the pulse. It has not landed. Do not
re-derive the claim here — two answers to one question is the duplication this
repo keeps removing (item 6c).

### Done when

The plan's `## Done when` list is the specification. The items that exist
*because a naive implementation would pass without them*:

- **Item 2** — a wave of an APPROVED plan still reads `eligible`. A fix that
  makes every wave unstartable passes item 1 and stops the fleet entirely.
- **Item 3** — `--next` must not offer a wave whose plan is unapproved. If the
  verdict and the startability answer disagree, the board and the dispatcher are
  back to disagreeing through a different field.
- **Item 4** — `plot-dispatch.sh` is UNCHANGED. Its phase gate stays the
  enforcement; this plan stops the fleet describing work that gate will refuse.
- **Item 5** — the word is not `blocked`.
- **Item 7** — no host call added to the scan's path.

Plus the repo's gates: `pnpm run validate`, `pnpm run test:reconcile`,
`pnpm run test:board` green; **artifact rebuilt and committed** if anything under
`packages/board` changes (`pnpm build:board` from the repo root); a changeset —
this is a `skills/plot/` change, so a `bumps:` block naming `plot`, NOT package
frontmatter; Node 24 (`nvm use`); `trash` rather than `rm`.

### Bookkeeping

When the PR is created, annotate this branch's line in the plan's `## Waves`
heading on main. This plan uses the **Waves** dialect, so the form is
`(Branch: x, PR: #N)` INSIDE the heading — a trailing `→ #N` parses as `prs=[]`
and was found doing exactly that on two plans today. Check
`git branch --show-current` is main before that edit, or use a detached scratch
worktree.

Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleet-scan.sh` and its tests, plus
whatever renders the verdict word if the board needs to learn the new one.

One other branch is in flight: `bug/the-board-reads-the-ref-not-the-checkout`
(worker running) holds `packages/board/src/server/board.ts` and a `CardSchema`
entry. It does not touch the scan. Rebase onto current main before you start.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
