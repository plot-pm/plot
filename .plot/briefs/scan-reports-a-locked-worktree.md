## Implementation brief — board-survives-its-agents, wave 2 (Continuity)

- **Plan (canonical):** `docs/plans/2026-08-17-board-survives-its-agents.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #157 merged (two interrogation rounds)
- **Branch:** `bug/scan-reports-a-locked-worktree` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

A worktree holding `.git/index.lock` becomes **its own signal** instead of being
skipped in silence. `.git/index.lock` means *an agent is writing here, right
now* — which is precisely what the fleet view exists to show.

### The plan's own first draft had this wrong, and the measurement corrected it

**Do not "fix" the exit-code handling — it is already correct.** An earlier
draft claimed the scan reads a failed `git status` as clean. It does not:
`plot-fleet-scan.sh:266` already reads the exit code, and the file argues the
rule at length — *"a failure to observe is not evidence of cleanliness"*. That
half is shipped and right.

What it does instead is `continue`:

```sh
else
  # A failure to observe. The worktree is not reported at all — neither its
  # dirtiness (unknown) nor its path (it may not be there).
  continue
fi
```

So the sweep survives and the branch answers from refs exactly as if this
machine had no worktree for it. The row then reads *"claimed, no commits yet"*:
**absent, not false — the right instinct applied to the wrong question.** The
fact is computed, discarded, and replaced by silence, and the branch that looks
least active is the one being committed to.

Not hypothetical: this session hit `index.lock` four times in the main repo
alone, once needing six retries while recording an approval.

### Four decisions the plan settles — do not re-derive them

**A lock joins `local_dirty` and `local_ahead` as a third signal**, under the
same five rules those obey. Three neighbouring facts, three questions:

| Signal | Question |
|---|---|
| `local_dirty` | someone is editing |
| `local_ahead` | finished work nobody else can see |
| `local_locked` | a write is in progress **this instant** |

Collapsing any pair repeats the one-label-two-states defect this story keeps
finding.

**A locked worktree must be distinguishable from a MISSING one.** Both fail
`git status`, and collapsing them recreates the absence ambiguity in a new
place. Read the exit code *and* the reason.

**It never downgrades a group** — the one-directional rule. A branch whose PR
already answers keeps answering about its PR.

**Do NOT retry or wait on the lock.** A lock held during a rebase can last
seconds, the next poll is 4 s away and will find it unlocked, and a scan that
blocks makes the pulse late for everyone else. **Reporting beats blocking.**

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **A locked worktree is reported as locked, not skipped.** Assert the row says
  a write is in progress: today the exit code is read correctly and then
  `continue` throws the answer away.
- **A locked worktree is distinguishable from a MISSING one.** Assert the two
  produce different rows.
- **`local_locked` never downgrades a group.** Assert against a branch whose PR
  already answers.
- **The scan does not retry or wait on a lock.** Assert the sweep's duration is
  unchanged with a lock held.
- **One locked worktree does not fail the sweep.** Assert the other worktrees
  still report — the case that produced `0 branches across 0 plans` with five
  agents running.

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

`skills/plot/scripts/plot-fleet-scan.sh` (the signal), the contract field that
carries it, `packages/board/src/server/fleet.ts` (`classify()` reading it), and
their tests.

**`feature/board-bridges-its-restart` is your wave-sibling and also edits
`fleet.ts`** — it adds disk persistence around the cache (`caches` Map at
`fleet.ts:180`), you add a rule to `classify()`. Different halves of the file,
but rebase rather than race, and keep your change narrow.

**Do NOT touch the pulse cache** — that is the sibling's work.

`bug/approve-button-needs-no-config` is also in flight (`approve.ts`,
`ApproveButton.tsx`) — no overlap with you except the artifact.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — the rebuild overwrites whichever side you
took, so the choice genuinely cannot matter.

**Note on CI:** two flaky failures hit this repo on 2026-08-17 on branches
containing no code, both in suites that start real servers on real ports. Wave 1
(#166) should have reduced that; if CI fails on a test you did not touch, check
whether it passes locally before assuming you caused it — and say so in your
report.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
