## Implementation brief — a-free-desk-is-nobodys (wave 1: The reaper reaches a free desk)

- **Plan (canonical):** `docs/plans/2026-09-22-a-free-desk-is-nobodys.md` on `main`
- **Approved:** 2026-09-22, in-session review
- **Branch:** `bug/the-reaper-reaches-a-free-desk` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review; `pnpm test` + `pnpm run test:contracts` are the gates

Sole wave, sole branch. Nothing waits on it and it waits on nothing.

### What to build

`plot-reap.sh` and `plot-reconcile-scan.sh` section 21 must both see a **detached** worktree under the configured `Worktree root`, and judge it by the five refusals they already apply to every other desk.

The observed failure: 19 worktrees on this machine, `reapable=0 kept=2 unplaced=1` — the reaper reaches **3 of 19**. Section 21 answers `desks=2` for the same reason. Thirteen detached `free-*` desks are not refused, not kept, not counted. The scan walks all nineteen on every pulse, and 19 trees at load 14 produced `Last scan failed: timed out after 90000ms — 19 worktrees` today.

The plan is canonical; this brief orients and records what is already settled.

### The decisions the plan settles — do not re-derive them

**The enumeration is NOT branch-keyed. Do not restructure it.** The plan's table says "enumerate the worktree list as well as the branch list", which reads as a missing enumeration. There is none. `plot-reap.sh:655` already loops over `git worktree list --porcelain`. The defect is one line inside the awk that feeds it:

```awk
/^worktree /{ if (br != "") print p"\t"br"\t"pr; p=$2; br=""; pr="no"; next }
/^branch /  { br=$2; next }
END         { if (br != "") print p"\t"br"\t"pr }
```

`if (br != "")` emits a record **only when a `branch ` line was seen.** Porcelain prints `detached` instead of `branch refs/heads/…` for a detached tree, so no record is ever emitted for one. Measured on this estate: **the awk emits 4 rows for 19 worktrees.** The thirteen are filtered out before any refusal is asked — which is why they appear in no line of either tool.

**The identical awk block appears in BOTH scripts** — `plot-reap.sh:655` and `plot-reconcile-scan.sh:2524`, byte-for-byte. One reading, duplicated. Fix both or they disagree, which is the thing section 21 exists to prevent.

**Section 21 holds no rule of its own — it asks the domain.** It builds readings, pipes them to `board/plot-reconcile.mjs` → `reconcile()` → `reap()`. So the shell change is *readings only*; the verdict logic is already shared. Do not add a `case` in shell deciding what a detached desk means — CLAUDE.md records that exact shape as the 2026-08-30 defect ("one line, in shell, that no test could reach, shadowing `ReapEvidence.isDispatchTree`").

**Section 21 already collects `d_detached` and can never receive `true` for it.** The field is assembled at `plot-reconcile-scan.sh:2520` and the filter above drops detached trees before it is computed. The slot was anticipated; wire it, do not invent a parallel one.

**The domain needs no change for the default-branch refusal.** `TreeReadings.branch` is documented as `''` when the head is detached, and `reapProblems` tests `readings.isMain || readings.branch === readings.defaultBranch`. `'' === 'main'` is false, so a detached desk passes that refusal correctly today. Verify before touching `reapable.ts` — a change there needs a corpus-tier justification it probably does not have.

**`free-*` is NOT the test — detachment is.** Measured 2026-09-22, three `free-*` desks now hold a branch (`free-719604d9` → `bug/the-status-asks-the-process-table`, `free-c810e5bb` → `feature/the-call-asks-only-for-the-delta`), and **two of them have live workers** (pids 27820, 6542). A free agent matched to a slice keeps its desk name. Keying on the prefix reaps two desks out from under running agents. The plan says "13 detached `free-*` desks"; on the live estate 16 are named `free-*` and 13 are detached, and the detachment is the reading.

**The merged-PR refusal needs an explicit statement, not an inheritance.** A free desk never held a slice, so it has no PR — and `merge !== 'merged'` would refuse every one of them forever, reproducing the silence in the opposite direction. The plan's reading: **a desk with no branch and no commits beyond its base has nothing to land and nothing to lose.** State that as its own condition. Do not weaken `no-merged-pr` for desks that *do* hold a branch.

**`is_dispatch_tree` stays exactly as strict as it is.** It accepts `.plot-worker.pid` or a legacy `plot-wt-` path, and the comment at `plot-reap.sh:440` says widening it trades a safe refusal for a wider blast radius. A detached desk under `Worktree root` that neither test places is `unclassified` — **reported, never promoted**, no `git worktree remove`. That vocabulary already exists (`unplaced=1` in the summary today).

**Rules carried over unchanged:**
- A hand-made checkout **outside** `Worktree root` stays silent. `test -d .plot` cannot separate it — the repo tracks `.plot/`, so every worktree has one. A person's tree must never become an instruction to remove it.
- The live-pid refusal is checked **first**. `--start` exists to create free desks; reaping one from under a waiting agent is worse than leaving thirteen.
- The reaper removes **checkouts only**. Refs are `plot-release-refs.sh`'s, and a detached desk has no ref to lose.
- The `vanished` (prunable) check is asked **before** the dispatch-tree filter and must stay there — four of the five refusals are unanswerable for a directory that is gone.

### Done when

The plan's `## Done when` is the specification. Beyond it, the assertions that exist because a naive implementation passes without them:

- **The awk emits one row per worktree — assert the count, not the content.** Today 4 of 19. A fix that handles detached trees but still drops, say, prunable ones passes every verdict test while leaving a population invisible. This is the assertion that catches "fixed the symptom I measured".
- **A detached desk with a live pid is `keep`, not `reap`.** Without this, the fix is a data-loss bug on exactly the population `--start` creates.
- **A `free-*` desk that holds a branch is judged by the branch, not the name.** Catches a prefix-keyed implementation — which reaps two live workers on this estate right now.
- **`plot-reap.sh`'s count and section 21's `desks=` agree on the same estate.** The plan's stated purpose ("the two must not disagree"); one fixed and not the other is the likeliest half-landing.
- **A tree outside `Worktree root` produces no output at all.** Not `keep`, not `unclassified` — silence.
- **No `git worktree remove` on an `unclassified` tree**, under `--yes`.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`, `pnpm run test:contracts`, and a `.changeset/*.md` with the description first and the `bumps:` block last. **Do not run `pnpm run test:e2e`** — it is CI's gate; measured, two local agents running it produced 53 concurrent processes and took the board down. Shell-script changes here do not need `pnpm build:board`.

### Bookkeeping

- Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). **Do not run `gh pr create`** — measured 2026-09-08, it takes the title from the last commit subject.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- Push the first real commit as soon as it exists.
- Commit subject prefix: `plot-reap:` / `plot-reconcile:` per the repo's convention, or `plot:` if the change spans both.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-reap.sh`
- `skills/plot/scripts/plot-reconcile-scan.sh` (section 21 and its readings only)
- the matching contract tests under `test/`
- one changeset

**Verified in flight at dispatch (2026-09-22):** two live workers — `bug/the-status-asks-the-process-table` (pid 27820) and `feature/the-call-asks-only-for-the-delta` (pid 6542). Neither touches these two scripts. `feature/one-monitor-watches-the-slice` sits `unclassified` with a PLOT-BLOCKED marker and no live worker; it is a subject of your test estate, not a collision.

**Do not reap anything by hand while implementing.** The thirteen desks are the fixture this change is measured against; removing them destroys the before/after reading. Use `--dry-run`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
