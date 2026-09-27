## Implementation brief — a-decision-reads-the-index (wave 3: The rule is written down)

- **Plan (canonical):** `docs/plans/2026-09-26-a-decision-reads-the-index.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `docs/the-rule-is-written-down` (base: `main`), claimed 2026-09-27
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as a doc change
- **Issue:** #1008

Wave 3 of 3, and the last. Both prior waves have merged: wave 1 as #1020 (`plot-impl-status.sh` reads the store), wave 2 as #1022 (`plot-reconcile-scan.sh` reads the store). Nothing waits on this branch. When it merges, the plan is ready for `/plot-deliver` — subject to the open Done-when lines named below, which a person decides on.

### What to build

A new section in `CLAUDE.md` that states the rule — *a tool call writes the index; a decision reads it, or is triggered by it* — beside the layering rule, with the two shipped consumers as its evidence. The plan says the rule goes in only after two consumers exist. They exist now, and that is why this slice is eligible.

Place it after `## A Shell Script Asks The Domain` (`CLAUDE.md:466`) and before `## The Master Agent Uses The Controllers`. That section is about how a script reaches a rule; this one is about where a rule's data comes from. The two sit together. Suggested heading: `## A Decision Reads The Index` (the plan's own name; a noun phrase of four words).

Update the plan's `## Slices` line for this branch with `→ #<number>` when the PR exists (see Bookkeeping). The plan is canonical. This brief gives orientation only.

### What the section must say — and must not claim

**State current behaviour, not the plan's aspiration.** The plan's rule has three parts. Measured at dispatch, they hold to different degrees, and the section must say which:

| Part | Status on `main`, 2026-09-27 |
|---|---|
| 1. A tool call writes the index and returns nothing a decision consumes | **Not yet.** The board is the only writer (`fleet.ts` folds the store). Both shell consumers still call `plot-host.sh pr-list` / `pr-state` on a miss and use the answer directly. |
| 2. A decision reads the index and spawns nothing | **Partly.** Two scripts read the store first through `board/plot-pr-index-lookup.mjs`, and fall back to the host. Neither is spawn-free. |
| 3. A decision may be triggered by an index update | **Not built.** No subscription exists. |

So write the rule as the direction the estate now follows, and name what holds and what does not. A section claiming all three parts hold would be the exact failure the plan cites: a rule in prose that describes something nobody does.

**The evidence to cite, from the merged code:**

- `plot-impl-status.sh` (#1020): a plan whose every slice merged costs zero host calls. Test: `test/reconcile/impl-status-index.test.mjs`, *"a fully merged plan is answered from the store with no host call"*.
- `plot-reconcile-scan.sh` (#1022): the merged-PR list is skipped only when every asked branch has a MERGED row; otherwise the store's rows and the host's list form a union, host lines first. Test: `test/reconcile/scan-index.test.mjs`, *"a store answering every asked branch removes the merged-list call"*.
- Both read through ONE bundle, `board/plot-pr-index-lookup.mjs`, which calls `decodePrIndex` — no `jq` over the file.

### Decisions the two slices settled — carry them into the rule, do not re-derive them

**Only a terminal answer is read from the index.** A `MERGED` row cannot revert on the host. `OPEN`, `CLOSED` and draft rows can be stale in either direction, and rows record no SHA to revalidate against. Both consumers therefore take MERGED rows and ask the host for everything else. This is `PLOT_TERMINAL_CACHE`'s licence (`plot-fleet-scan.sh:1234`), which the plan adopts whole. Tests: *"a store row that is OPEN gives the host the last word"*, *"a draft row is re-asked rather than answered from"*.

**The index never says no.** A missing store, a missing row, a wrong-version or unparseable store, and a missing bundle all mean *ask the host*. A missing row in a `complete: false` store is not proof that no PR exists, and even a `complete: true` store knows nothing opened after its `at`. Wave 2 recorded the consequence: **the index can supply `pr: 'MERGED'` but not `pr: 'none'`.** Put this sentence in the rule — it is the invariant a future consumer breaks first.

**One writer.** The shell consumers read and never write. A second writer beside the board races, because `rename` makes each write atomic but not the read-fold-write around it. The rule must say who writes, or part 1 reads as licence for every script to write.

**Answers, never verdicts.** The plan's Design section states it and `fleet.ts:2173` refuses a persisted verdict. The index holds bought answers (a host's merge state); every verdict is still derived fresh.

**Not behind HTTP.** A shell consumer reads the file through a bundle and needs no running board — the reason `plot-ask.mjs` exists.

### Facts the plan got wrong — do not repeat them in the rule

- **"Zero consumers" was false before wave 1.** The board already read and wrote the store (`fleet.ts`, since `83c4abdc1`). The two scripts are the first *shell* consumers. Say that.
- **The CI ratchets do not count either consumer.** *One place reaches a process* (`ci.yml:333`, `allowed=28`) counts TypeScript `spawn`/`execFile` under `packages/`; `check-script-names.sh` does not list `plot-reconcile-scan.sh`. **Do not lower `allowed` or edit a ratchet comment** to make the rule look earned.
- **The saving does not fire on this machine today.** Wave 2 measured it: the live store here was `v: 1` against `PR_INDEX_VERSION` 2, so every read fell through to the host, and 3 of 5 remote branches were in flight with no MERGED row. Do not state a measured saving; state the mechanism and its tests.

### Done when

The plan's `## Done when` list is the specification for the whole plan, not this slice. This slice is documentation, and it cannot satisfy four of the five lines. Measured at dispatch:

| Done-when line | Status |
|---|---|
| A named decider reads its inputs from the index and has zero spawn sites | **Open.** Both consumers read first and still fall back to the host. |
| The CI spawn ratchet falls | **Unreachable from these consumers** — see above. |
| An unobtainable entry is absent, proved with an unreachable host | **Met** by both slices' *"an unreachable host … "* tests. |
| A stale entry is discarded on read, proved by moving the ref | **Partly.** Non-terminal rows are never trusted (host has the last word); no test moves a ref, because rows carry no read-against SHA. |
| Two consumers asking the same question in one pass produce one tool call | **Open.** Wave 2 left it open explicitly. |

**List this table in the PR body.** Do not close the open lines from a docs branch, and do not reword them in the plan. The plan's rule: *report rather than improvise.* A person decides whether the plan delivers with them open or gains a follow-up plan.

This slice is done when:

- `CLAUDE.md` holds the new section, stating the rule, which parts hold today, the five settled decisions above, and the two consumers with their test names.
- The section contains no claim a reader can falsify from `main` (no "zero consumers", no saving figure, no ratchet movement).
- Every paragraph and list item is one line — no hard-wrapping (the newer `CLAUDE.md` sections follow this; the older hard-wrapped ones are not the model).
- `pnpm test` passes (it validates skill parsing; `CLAUDE.md` is not a skill, but the gate is cheap and the repo asks for it).

No changeset is needed: `CLAUDE.md` is a repo-level file, and neither `packages/*/src/` nor `skills/` changes. If you touch a skill, add one per `CLAUDE.md` › Versioning.

### Bookkeeping

- Push the first real commit as soon as it exists. The branch was claimed at `origin/main` with no commits.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`).
- When the PR exists, append it inside the wave heading on `main`, in the form the parser reads: `### The rule is written down (Branch: docs/the-rule-is-written-down, PR: #<number>)`. Use a detached scratch worktree on `origin/main`, not the shared main worktree.
- Commit convention: plain description (repo-level file), e.g. `A decision reads the index: write the rule down`.

### Scope guard

This branch owns **`CLAUDE.md` only**, plus the PR annotation in the plan file on `main`. It changes no script, no test, no bundle, no CI file.

In flight at dispatch (2026-09-27): the only open PR is #978 `changeset-release/main`, which does not touch `CLAUDE.md`. No other branch holds this file.

If you find something the plan did not anticipate — for example, that a third consumer is needed before the rule is honest — report it in the PR body or a `PLOT-BLOCKED` marker rather than building it here.
