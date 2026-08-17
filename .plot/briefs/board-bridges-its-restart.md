## Implementation brief — board-survives-its-agents, wave 2 (Continuity)

- **Plan (canonical):** `docs/plans/2026-08-17-board-survives-its-agents.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #157 merged (two interrogation rounds)
- **Branch:** `feature/board-bridges-its-restart` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The last good pulse survives a `node --watch` restart, so a restarting board
serves *old numbers, labelled* instead of an empty view.

Measured on 2026-08-17 with five agents in flight: the Agents tab reported
*"Last scan failed"* and rendered **`0 branches across 0 plans`** — not a stale
view, an **empty** one. Three of the five agents were editing files under
`packages/board/`, and every save restarts the server under `--watch`.

### The cache exists; it is in the wrong place

**Do not build a cache.** `fleet.ts:180` already holds
`const caches = new Map<string, CacheEntry>()`, keyed per repo, with PR data
cached beside the pulse under its own timestamp. Every request reads it while
the scan refreshes it asynchronously — that design is right and is why the tab
polls at 4 s without running a scan per request.

It is **process memory**, so a restart takes it with the process. Nothing is
missing from the mechanism except that it does not outlive the thing it is
protecting against.

So: the in-memory cache gains a copy on disk at
**`.plot/state/last-pulse.json`** — beside the other `.plot/state` the fleet
already keeps — written on each successful scan, read once at startup, replaced
the moment a real scan completes.

### Five decisions the plan settles — do not re-derive them

**Rescanning immediately instead is not enough, and both are wanted.** A scan
costs 500–1050 ms, and a **cold boot was measured at 21.2 s** during the dimming
work. Scanning at startup narrows the empty window without closing it, and a
`--watch` restart storm reopens it on every save. So read the file at startup
**and** kick off a scan at once: the file covers the gap, the scan ends it.

**It is a bridge, not a store, and that distinction is load-bearing.** Plot
derives state from git (Principle 1), and a JSON file that outlives its
usefulness is a second source of truth that can disagree with the repository.
Past a threshold the honest answer is *"no data"* — which is what the board says
today and is correct once the numbers are meaningless.

**A successful scan wins immediately; a FAILED scan must not overwrite the
file.** The same one-directional rule the local signals obey — a failure must
not destroy the last good answer, which is the only thing standing between a
restart and an empty board.

**Stale is a state the page already renders.** The banner, the `(frozen)` footer
and the stopped clocks exist from #141, and `board-dims-when-lost` (#160) added
the dimming above them. Feed those mechanisms; do not invent a second vocabulary
for *these numbers are old*.

**Wave 1 has landed (#166),** so `PLOT_EXIT_WITH_PARENT` now stops test servers
from outliving their run. That is why this wave can trust its own test results —
and why it goes second.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **A restart serves the previous pulse, labelled with its age**, rather than
  `0 branches across 0 plans`. Assert across an **actual process restart**, not
  a cleared in-memory map: the map is already correct, and its loss on restart
  is the entire defect.
- **A stale-enough cache is not served.** Assert the board says *no data* past
  the threshold: a bridge that never expires is a store, and a store of
  git-derived state is a second source of truth.
- **A fresh scan replaces the file immediately.** Assert the bridge never wins
  over a real answer.
- **A FAILED scan does not overwrite the file.** The one-directional rule.
- **A startup rescan is issued alongside the file read.** Assert **both**
  happen — the file alone leaves the board stale until the next poll, and the
  scan alone leaves the measured 500–1050 ms (21.2 s cold) window empty.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present.
macOS bash 3.2 — **no `declare -A`**.

**Versioning:** do NOT edit versions by hand. Declare the bump in your changeset's
`bumps:` block — `CLAUDE.md` was corrected on 2026-08-17 after describing manual
bumps the repo has not done for six releases.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists.**

### Scope guard

`packages/board/src/server/fleet.ts` (persisting and reading the cache), the
state file itself, and their tests.

**`bug/scan-reports-a-locked-worktree` is your wave-sibling and also edits
`fleet.ts`** — it adds a `local_locked` signal to `classify()`, you add
persistence around the cache. Different halves of the file, but rebase rather
than race, and keep your change narrow.

**Do NOT touch `plot-fleet-scan.sh`** — that is the sibling's file.

`bug/approve-button-needs-no-config` is also in flight (`approve.ts`,
`ApproveButton.tsx`) — no overlap with you except the artifact.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — the rebuild overwrites whichever side you
took, so the choice genuinely cannot matter.

**Note on CI:** two flaky failures hit this repo on 2026-08-17 on branches
containing no code, both in suites that start real servers on real ports. Wave 1
should have reduced that; if CI fails on a test you did not touch, check whether
it passes locally before assuming you caused it — and say so in your report.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
