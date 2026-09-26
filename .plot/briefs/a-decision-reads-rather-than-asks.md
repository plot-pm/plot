## Implementation brief — a-decision-reads-the-index (wave 2: A decision reads rather than asks)

- **Plan (canonical):** `docs/plans/2026-09-26-a-decision-reads-the-index.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Branch:** `infra/a-decision-reads-rather-than-asks` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code
- **Issue:** #1008

Wave 2 of 3. This branch waits on `infra/the-index-has-its-first-consumer` (wave 1) merging. `plot-fleet-scan.sh --next` does not offer it before then. `docs/the-rule-is-written-down` (wave 3) waits on this branch. Read wave 1's merged PR body before you start: wave 1 was told to record there what it learned about the store, and this slice's choice of consumer depends on it.

### What to build

Move the second consumer from asking the host to reading `PrIndexStore`. The plan leaves the choice open between `plot-reconcile-scan.sh` and `plot-fleet-scan.sh`, and says the slice names which and why. Name the choice and the reason in the PR body. The facts below are measured at dispatch so that the choice starts from them, not from the plan's call counts.

The plan is canonical. This brief gives orientation only.

### The two candidates — measured 2026-09-26

**`plot-reconcile-scan.sh`** asks the host at four sites:

- `:473` `pr-list --state open` → `open_prs`. Sections 3 and 19 gate on it through `pr_reliable` (`:1119`, `:2272`). Section 3 is inside the blocking set 1–5 that `/plot-deliver` reads.
- `:503` `pr-list --state merged --limit $MERGED_PR_LIMIT` (500) → `merged_pr_heads`, read by `:991-998` and section 20. A failure here is tolerated by design.
- `:3001` `pr-state <last_pr>` once per delivered plan, section 6, for `.mergeCommit`. The script's own comment measures ~11 minutes for 82 delivered plans.
- `:2860` `issue-list`, section 23. This is a tracker question, not a PR question. The store does not hold it. Out of scope.

**`plot-fleet-scan.sh`** asks the host at `:879` (`pr-list --state open --rich`), `:895` (`pr-list --state all`), and `:1164` (`pr-state` per branch, the fallback). It already caches per run on disk (`HOST_STATE_CACHE`) and across runs through the board (`PLOT_TERMINAL_CACHE`, `:1240`). **The board's 5 s pulse asks the host nothing**: `HOST_LOOKUP_OK` (`:557`) is set only by `--fetch` or `--next`. So the host calls this scan makes are the dispatch path (`--next`), where a stale answer hands out work that already merged — the incident at `:540` (PR #679, ten re-claimed refs).

**The live store, 2026-09-26 15:13Z:** `v: 2`, 968 rows (932 `MERGED`, 34 `CLOSED`, 2 `OPEN`), `complete: false`. Row keys: `author, checks, draft, failing_checks, head, mergeable, number, review, state, updatedAt, url`. **No `mergeCommit`, no `mergedAt`, no read-against SHA.**

**Recommendation, subject to wave 1's findings:** `plot-reconcile-scan.sh`, merged list first. The reasons:

- Its merged list is a terminal question, and the store already answers it better than the call it replaces: 932 `MERGED` rows against a host call capped at 500, which today sets `MERGED_PR_TRUNCATED`.
- Its failure mode is advisory, so a wrong design shows up as a finding, not as a dispatched slice.
- The fleet scan's host calls sit on the dispatch path, which is the one place a stale non-terminal row costs a worker. Take it only if wave 1 shows that non-terminal rows can be revalidated.

If you take the fleet scan instead, say why in the PR, with wave 1's evidence.

### Facts the plan got wrong — do not repeat them

**The CI ratchets do not count either candidate.** The plan's Done-when says *"The CI spawn ratchet falls, and its comment no longer names that decider's scripts as portless."* Measured at dispatch:

- *One place reaches a process* (`ci.yml:331`, `allowed=28`) counts TypeScript `spawn`/`execFile` sites under `packages/`. Today it finds 21. None of them is a host retrieval that either scan performs. Shell scripts are not counted.
- *A script is named in an adapter* (`scripts/check-script-names.sh`, 9 of 9 allowed) counts `plot-*.sh` names in the board. `plot-reconcile-scan.sh` is not in it. `plot-fleet-scan.sh` is, at `fleet.ts:1058`, but the list marks it as one of the two that already have a port (`refs.pulse`, `refs-git.ts:135`). Its data source does not affect that count.

So neither candidate moves either ratchet. **Do not lower `allowed` or edit a ratchet comment to claim this item.** State in the PR body that this slice cannot satisfy that Done-when line and why, and leave the decision about the plan to a person. That is the plan's "report rather than improvise" rule.

**"Zero consumers" was already false before wave 1.** The board reads and writes the store (`fleet.ts:2537`, `prWindowFor` at `:2842`, the fold at `:2734`, since `83c4abdc1`). Wave 1 is the first shell consumer and this slice is the second. Do not write "zero consumers" in the PR or the changeset.

### Decisions to take as settled

These carry over from wave 1's brief unchanged. Check wave 1's merged code before you re-implement any of them, because it may already expose them.

**Trust only terminal answers from the store.** A `MERGED` row cannot revert on the host. `OPEN`, `CLOSED` and draft rows can be stale in either direction. Rows record no SHA to revalidate against, so a non-terminal row is not an answer this slice may act on without asking the host. This is the `PLOT_TERMINAL_CACHE` rule (`plot-fleet-scan.sh:1234`), which the plan adopts whole.

**`complete: false` means absence is not proof.** A branch with no row falls back to the host. It never reads as "no PR". For the reconcile scan's open list this matters directly: `pr_reliable` must stay `0` whenever the open list is not a whole answer, or section 3 reads every branch as orphaned.

**Absence stays absence.** An unreachable host with no store gives today's `PR_SOURCE=failed`/`absent`, never an empty list read as a value. `--offline`/`--no-pr` keeps meaning *no network*. Reading a local file does not break that promise, so the store may answer under `--offline`. Say so in the scan's header if you do it.

**Read through the domain, not with `jq` over the file.** If wave 1 shipped a bundle that reads the store, call it. If it did not, the reason in wave 1's brief still holds: `decodePrIndex` owns the version check, and a `jq` reader drifts the first time `PR_INDEX_VERSION` moves. The reconcile scan runs once per operator command, so the 39 ms bundle cost (`docs/shell-and-domain.md`) is inside budget.

**Resolve the store from `--git-common-dir` and honour `PLOT_PR_INDEX_HOME`.** Never `--show-toplevel`: `plot-reap.sh` deletes desks.

**The host stays behind `plot-host.sh`**, gated by `scripts/check-host-cli-callers.sh`.

**`mergeCommit` is not in the row.** Section 6 needs it. Either keep section 6's `pr-state` call, or add the field to the row schema through the domain (`PR_INDEX_VERSION` bump, a fold test, and the board's writer at `fleet.ts:2734` must then fill it). Never emit an empty `mergeCommit` as if the host said so. Adding the field is the larger change. Take it only if it is the reason you chose this consumer, and say so.

### The open question this slice inherits

Wave 1 was told to stay read-only and to name the write as wave 2's question: should a script that falls back to the host fold what it learned into the store? The plan's Done-when *"Two consumers asking the same question in one pass produce one tool call"* needs a writer other than the board. A second writer beside the board adds a lost-update race: the adapter's `rename` makes each write atomic, but not the read-fold-write sequence. Answer it in this PR with one of:

- **Write, and prove the race is harmless** with a test in which two writers interleave. A partial fold only adds rows, and `complete` latches down, so a lost update loses rows the next writer adds again. The test must show that no interleaving sets `complete: true` on a partial answer.
- **Stay read-only**, and state that the one-tool-call item stays open for wave 3 or a follow-up plan.

Do not write silently.

### Done when

The plan's `## Done when` list is the specification. This slice owns these parts of it, and names the ratchet item as unreachable (see above):

- **The chosen decider answers from the store with fewer host calls than today, counted.** Use a `plot-host.sh` stub that counts calls. `test/reconcile/impl-status-dialects.test.mjs` (`stubGh`, `:48`) and wave 1's tests show the pattern. This catches a reader that reads the store and then asks the host anyway.
- **An unreachable host with no store gives today's output**, `PR_SOURCE` included. This catches a fallback that turns a failed read into an empty list, which `pr_reliable` then trusts.
- **A store that is `complete: false` and lacks a branch's row gives the host's answer for that branch.** This catches absence read as "no PR".
- **An `OPEN` row for a PR the host reports `MERGED` gives the host's answer.** This catches trusting non-terminal rows.
- **A missing, unparseable or wrong-version store gives exactly today's output.**
- **The store is found from a linked worktree.**
- If you write to the store: **the interleaving test above.**
- Tests set `PLOT_PR_INDEX_HOME` and never touch the operator's store under `.git/.plot/state/index/`.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (rebuilds the artifact), `pnpm run typecheck`. Do NOT run `pnpm run test:e2e` locally — CI runs it. Add a changeset: description first, `bumps:` block last, package `plot`, plus `'@plot-pm/board': patch` if you touch `packages/board`. Update the chosen script's row in `CLAUDE.md`'s helper table. A reconcile-scan change that alters a section's counter needs the section's own paragraph in that row updated too.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (or `--draft`). Do not run `gh pr create`.
- When the PR exists, change this branch's heading in the plan's `## Slices` to `(Branch: infra/a-decision-reads-rather-than-asks, PR: #N)`. That is the heading form `plot-plan-meta.sh` parses. A trailing `→ #N` parses as `prs=[]`.

### Scope guard

This branch owns:

- the chosen script (`skills/plot/scripts/plot-reconcile-scan.sh` or `skills/plot/scripts/plot-fleet-scan.sh`) — one of them, not both
- its tests under `test/reconcile/`
- a bundle entry under `packages/board/src/server/entry/` and its artifact, only if wave 1 did not ship one that answers
- `packages/domain/src/**/pr-index*` — only for the `mergeCommit` field or the writer decision, each with its tests
- the `CLAUDE.md` helper-table row, the changeset

Not this branch: `plot-impl-status.sh` (wave 1), `CLAUDE.md`'s rule text (wave 3), the CI ratchets and their comments, `fleet.ts`'s `refreshPrs` except where the `mergeCommit` field requires it, section 23's tracker question.

Verified at dispatch, 2026-09-26: of the 60 most recently updated remote branches, only `bug/the-index-is-read-once` touches `plot-reconcile-scan.sh`, and it merged as #948 (a leftover ref, and a different index: the plan `active/`/`delivered/` indexes). No live branch touches either scan or `pr-index`. Wave 1 is claimed and has no commits yet. Check `git diff origin/main...origin/infra/the-index-has-its-first-consumer --stat` again before you start.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
