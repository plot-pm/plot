## Implementation brief — a-partial-pulse-does-not-say-not-merged (wave: Verdicted)

- **Plan (canonical):** `docs/plans/2026-08-27-a-partial-pulse-does-not-say-not-merged.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/the-deliver-gate-reads-the-verdicts` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

Single wave; nothing waits on it and it waits on nothing.

### What to build

The board refuses to deliver a plan whose every branch has merged, saying *a
branch is not merged*. `allWavesMerged` (`board.ts:427`) opens with a lookup:

```ts
const plan = pulse?.plans.find((p) => p.file === path.basename(meta.file));
if (!plan) return false;
```

**`false` means "not merged".** When the scan times out the pulse carries
`plans: []` — so the lookup fails and the gate reports a claim about branches
that the same payload contradicts.

Measured against the live board's payload, the same minute an operator hit it:

```
complete:      False        ← the scan timed out
plans array:   0
waves array:  52
this plan in waves: 2 → all complete: True
```

Both of that plan's PRs had merged the day before (#446, #454).

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Fix it in `allWavesMerged`, NOT in the route.** The function has **two**
callers and the operator meets both symptoms at once:

- `deliver.ts:209` — the Deliver gate, the refusal.
- `board.ts:499` — inside `planStatus`, deciding `deliverable`.

So the same partial pulse that refuses the button also renders the CARD as
`in-progress`. Fixing the route alone leaves a card that will not offer what the
button would allow. Item 7 asserts the card.

**Read the wave verdicts; do not recompute from branch states.** The pulse's
`waves` array already carries a per-wave `verdict` (`complete`/`eligible`/
`blocked`/`unapproved`/`deferred`), computed by the scan from the same branch
states this function re-derives. A plan whose every non-deferred wave is
`complete` has landed, by the scan's own arithmetic. Item 6 is about exactly
this: two derivations of one question is what this repo keeps removing.

**No plumbing is added.** `FleetWaveSchema` already carries `verdict`
(`schema.ts:1817`) and the pulse already carries `waves` (`:1839`). If you find
yourself adding a schema field, stop — you are solving a different problem.

**A fifth verdict, not a fifth reason for an existing one.** Today there are
four: `deliverable`, `not-found`, `already-delivered`, `not-merged`. *Scan
incomplete* is a NEW one. Folding it into `not-merged` **is the present
defect**; folding it into `not-found` would claim the plan does not exist.

**Absent is not false — this is the repo-wide rule the gate breaks.**
`plot-host.sh` reports `checks:"unknown"` rather than red; `--next` exits 1 for
*nothing to start*; the adapter separates a failed lookup from an empty one. The
two states here need OPPOSITE responses: *your branches have not landed* means
go finish the work, *the scan did not finish* means wait and retry.

**Not chosen: fix the timeout instead.** It has its own plan, and that plan
shipped as #486 — the scan is now ~6.6s offline. Irrelevant to this: **a gate
that answers wrongly from partial data is wrong at 111 s and at 6 s.** Any scan
can be interrupted, and the board renders `complete: false` whenever one is in
flight.

**Not chosen: fall back to asking the host.** It puts host latency on a click
path, re-derives a fact the scan owns, and makes the answer depend on which of
two sources replied.

**Not chosen: treat a missing plan as deliverable.** The inverse error, and
worse — `false` at least fails safe.

### Done when

The plan's `## Done when` list is the specification, all 8 items. The ones that
exist *because a naive implementation would pass without them*:

- **Item 4** — a plan with a genuinely unmerged non-deferred branch is **still
  refused**, on a COMPLETE pulse. A fix that always returns deliverable passes
  item 1 and destroys the gate. Assert this separately.
- **Item 7** — the CARD, not just the button. One cause, two symptoms.
- **Item 5** — a deleted branch does not change the answer. Measured
  2026-08-27: the scan reports `merged` for a branch whose ref is gone. This
  hypothesis was raised and refuted while diagnosing; the item pins it refuted.
- **Item 3** — the message names the SCAN, not the branches. A reader told *a
  branch has not merged* about a merged branch goes looking for work that does
  not exist. That is what happened.

Plus the repo's gates: `pnpm run validate`, `pnpm run test:board` green;
**artifact rebuilt and committed** (`pnpm build:board` from the repo root — from
`packages/board` it is `pnpm build`); a changeset with `'@plot-pm/board': patch`
**package frontmatter** (a board change does NOT use a skills `bumps:` block);
Node 24 (`nvm use`, and `corepack pnpm` — homebrew pnpm runs its own node and
crashes); `trash` rather than `rm`.

Board browser tests load the BUILT artifact — build before running them or you
will test a stale bundle and get reassuring green.

### Bookkeeping

When the PR is created, annotate this branch inside its **wave heading** in the
plan's `## Waves` section on main: `(Branch: x, PR: #N)` INSIDE the heading. A
trailing `→ #N` parses as `prs=[]` in the Waves dialect. Check
`git branch --show-current` is main first, or use a detached scratch worktree
(`git worktree add --detach <path> origin/main`).

Push your first real commit as soon as it exists.

### Scope guard

This branch owns `allWavesMerged` in `packages/board/src/server/board.ts`, the
Deliver route's verdict handling in `deliver.ts`, whatever renders the button's
message, and their tests.

`feature/a-finished-plan-delivers-itself` is in flight and also touches
delivery — it calls `plot-deliver.sh` from the board and reaps afterwards. It
does NOT touch `allWavesMerged`. Rebase onto current main before you start.

Note `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json` is a
**tracked fixture** that board test runs rewrite — check `git status` before
committing and never `git add -A` after a suite run.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
