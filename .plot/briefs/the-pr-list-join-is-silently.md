## Implementation brief — the-pr-list-join-is-silently (wave: Complete)

- **Plan (canonical):** `docs/plans/2026-08-25-the-pr-list-join-is-silently.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/the-pr-list-join-is-silently` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

Single wave; nothing waits on it and it waits on nothing. Its stated dependency,
`the-adapter-checks-the-cli-it-got`, merged as **#460** on 2026-08-26 — the
adapter now verifies it reached a capable `bb`, so truncation detection has a
real answer to detect against.

### What to build

`plot-host.sh pr-list` must stop serving a partial page as if it were the whole
set on Bitbucket.

The concrete failure, measured 2026-08-26 against `quatico/quaweb-website` with
`bb` 1.0.0:

```
merged PRs returned : 50          ids 836 → 787
open                : 4
newest PR in repo   : #836
```

Fifty exactly, against a repo numbering to 836 — roughly **780 older merged PRs
are invisible to the join**. Every branch older than #787 joins to nothing and
reads as *no PR*, which is the fabricated verdict the scan refuses everywhere
else. This is not a tail case: it is ~94% of merged PRs on a real client repo,
and the threshold was crossed long ago without anyone seeing it, because the
failure is a quiet empty join plus a stderr line nobody surfaces.

`bb pr list` has no `--limit`, so `plot-host.sh` drops it (and says so on
stderr, `plot-host.sh:494`). GitHub honours it and is unaffected.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The repair goes INSIDE `plot-host.sh pr-list`, not in its callers.** There are
**two** consumers, and this is the round-three finding that reshaped the plan:
`plot-fleet-scan.sh:474` (`prefill_pr_states`) and
`packages/board/src/server/fleet.ts:1552` (`pr-list --rich`, the board's own PR
timer). Both join a bulk list locally; both are exposed. Repairing in the scan
alone leaves the board joining a partial list exactly as before; repairing in
both puts one fallback in bash and another in TypeScript, free to drift.
`plot-host.sh` is documented as the ONE place that talks to the host CLI, and a
page cap is a property of *how the host answered*. Same argument that put the
CLI capability check there in #460.

**Neither caller changes.** If your diff touches `plot-fleet-scan.sh` or
`fleet.ts`, the design has drifted — `Done when` item 5 asserts both are
untouched.

**Truncation is detected against the REQUESTED LIMIT, never the constant 50.**
`count == 50` fails silently in the dangerous direction: a future `bb` returning
100 would make a 100-PR state report complete while truncated — this plan's own
defect, restored. Comparing against what was asked for misfires benignly (says
truncated when a state holds exactly the limit, costing a few lookups) and
cannot misfire dangerously.

**Pagination is closed, on a measurement not a guess.** `bb pr list` 1.0.0
exposes only `--state`, `--json`, `--repository`, `--web`. No cursor, no offset,
no limit. Do not go looking for one.

**The bound comes from the GAP, not from a branch list.** Round two bounded the
fallback to `wip` branches using a derivation the *scan* has for free. Moving
the repair into the adapter takes that away: `plot-host.sh` is handed no branch
list and holds no notion of `wip`. What it *can* see is which PR ids a truncated
page did not cover — `bb` numbers monotonically, so a page returning 836 → 787
states its own gap. Resolve the gap, not a branch list.

**A cap of N lookups is not an acceptable bound.** It would drop the N+1st
silently — the same quiet incompleteness this plan exists to remove, one level
in.

**Absent is not false.** Where the gap cannot be closed, emit what you have
*plus* a `truncated` marker. A partial list served as a whole one is the failure
this plan is named for; a partial list that says it is partial is honest.

### The open question this wave has to answer

**Is closing a ~780-PR gap affordable at all?** One call at a time it plainly is
not, and `Done when` item 3 makes this a gate rather than an implementation
detail: *a repair whose cost scales with the gap has moved the failure into
latency rather than removing it.*

If you find the gap cannot be closed within a sane budget, **that is a result,
not a failure** — implement the honest-`truncated` half (items 1, 4, 6, 7) and
report what you measured. Do not ship a fix that makes every Bitbucket pulse
take minutes.

### Done when

The plan's `## Done when` list is the specification — all 8 items. The ones that
exist *because a naive implementation would pass without them*:

- **Item 1** — detection against the requested limit, not `50`. A hardcoded
  constant passes every test you would naturally write today and restores the
  bug on the next `bb` release.
- **Item 2** — a branch whose PR is beyond page one resolves to that PR. This is
  the only item that fails on a fix which merely *reports* truncation.
- **Item 5** — both callers untouched in the diff.
- **Item 6** — no extra host call on GitHub. A fallback firing on the common
  path is a regression for every GitHub user; assert by call count.

Plus the repo's gates: `pnpm run validate` and `pnpm run test:reconcile` green,
a changeset with its `bumps:` block (this is a `skills/plot/` change, so bump
`plot`), Node 24 (`nvm use`), and `trash` rather than `rm`.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Waves` heading on main — note this plan uses the **Waves** dialect, so the
annotation goes *inside* the heading as `(Branch: x, PR: #N)`, not as a trailing
arrow. Check `git branch --show-current` is main before that edit, or use a
detached scratch worktree.

Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` and its tests. It does **not**
own `plot-fleet-scan.sh` or `packages/board/` — both are explicitly out of scope
by `Done when` item 5.

No other branch currently holds `plot-host.sh`. `#465`
(`bug/a-dispatch-without-a-brief-refuses`) touched `plot-dispatch.sh` and merged
this morning; rebase onto current main before you start.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
