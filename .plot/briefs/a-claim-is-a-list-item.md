## Implementation brief — a-citation-is-not-a-claim (wave: Anchored)

- **Plan (canonical):** `docs/plans/2026-08-23-a-citation-is-not-a-claim.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/a-claim-is-a-list-item` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

**This is wave 1 of 2.** The `Counted` wave (`bug/reconcile-reports-a-double-claim`)
adds the double-claim report and is positionally blocked until this merges. Do not
build it here — and note the two are genuinely sequential: a double-claim report
built on the OLD matcher would report citations as duplicate claims, which is the
very defect this wave removes.

### What to build

The branch-name matcher in the plan parser reads a backticked branch name
**anywhere on a line** as a claim. So a plan that merely *mentions* another
plan's branch — in a blockquote, mid-sentence, or an HTML comment — claims it.
`/plot-dispatch` then fans out a branch the plan does not own.

Move the matcher from *anywhere on the line* to *anchored at the start of a list
item*:

```awk
branch_claim_re = "^[ \t]*-[ \t]+`(" PREFIXES ")/[^`]+`"
```

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Rewording is not the fix, and this is a gates-over-rules call.** "Do not
backtick a branch name you do not own" is a rule an author must remember, in the
one section where writing branch names is the entire point — and it has already
been forgotten twice. The parser must be *unable* to read a citation as a claim.
Do not propose a lint, a convention, or a docs note instead.

**The anchor is licensed by a measurement, not a preference.** Every real claim
in this repo has exactly one shape: `- ` then immediately a backticked name. A
stricter rule that dropped real claims would be a regression; the sweep is what
says it drops none. Re-run the sweep yourself before you trust the anchor — do
not take the plan's word or this brief's.

**Do not hardcode a claim total.** The plan was written against 248; on main
2026-08-27 the anchored count is **200** against **616** loose occurrences. The
`Done when` item is deliberately **differential** — count before, count after,
require equality. An absolute number fails a correct implementation, and the
estate moves under it weekly. (The ratio is the argument, and it got stronger:
about two in three backticked branch names in `docs/plans/` are citations.)

**Beware the awk quoting trap.** `plot-plan-meta.sh`'s awk program is inside a
single-quoted shell string. An apostrophe anywhere in the awk region — including
in a comment — closes the quote early and produces syntax errors that do not
point at the apostrophe. Never write `'` in that region.

**Fenced code blocks are already ignored** by the plan parser. A `## Branches`
example inside a fence is illustration, not a claim — do not "fix" that too, and
do not let the new anchor accidentally start reading fenced content.

### Done when

The plan's `## Done when` list is the specification. The items that exist
*because a naive implementation would pass without them*:

- **The blockquote case** and **the mid-sentence case are different.** In the
  blockquote the whole line is not a claim; mid-sentence, the line **is** a claim
  and the citation sits inside it. An anchor that only handles the first case
  passes one test and fails the other.
- **The differential count** — the guard against a stricter matcher silently
  dropping a real claim.
- **`→ #N`, `deferred`, `claimed` and `moved` annotations still bind.** These are
  parsed off the same lines; an anchor change can break them without touching
  claim detection.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:e2e` green; a changeset with a `bumps:` block naming `plot` (this
is a `skills/plot/` change, NOT package frontmatter); Node 24 (`nvm use`, and
`corepack pnpm`); `trash` rather than `rm`.

Run `test:e2e` with `env -u PLOT_UNATTENDED` — that variable in the ambient
environment trips a control test.

### Bookkeeping

When the PR is created, annotate this branch inside its **wave heading** in the
plan's `## Waves` section on main. This plan uses the **Waves** dialect, so the
form is `(Branch: x, PR: #N)` INSIDE the heading — a trailing `→ #N` parses as
`prs=[]`. Check `git branch --show-current` is main before that edit, or use a
detached scratch worktree (`git worktree add --detach <path> origin/main`).

Push your first real commit as soon as it exists.

### Scope guard

This branch owns the branch-matcher in `skills/plot/scripts/plot-plan-meta.sh`
and its tests. `plot-reconcile-scan.sh`'s new section belongs to wave 2.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
