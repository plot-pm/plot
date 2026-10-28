# Juror verdict: git-host connector and the merged-PR question

Position: amend

Evidence: Read the plan, issue #2825, `packages/board/src/server/entry/reap.ts` (`:430-462`, `:775-800`, `:885-927`, `:980-1058`, `:1240-1276`, `:1284-1340`), `packages/domain/src/rules/sweepable.ts:50-100`, `packages/domain/src/ports/host.ts:33,50-90,229-243`, `packages/domain/src/adapters/host/host-shell.ts:305-391`, `packages/domain/src/adapters/refs/refs-git.ts:760-772`, `skills/plot/scripts/plot-host.sh:60-90,658,4222-4268`, and `scripts/check-ancestry-decisions.sh`. I ran four things. (1) A node probe of the real `firstBranchRefusal` (copied into the scratch dir, Node 24 type stripping) with the readings reap builds. (2) A scratch git repo: a fresh branch with no commits of its own, a squash-merged branch, and a squash-merged branch with one commit added after the merge, each checked with `merge-base --is-ancestor` and `git cherry`. (3) `scripts/check-ancestry-decisions.sh` against the worktree. (4) Read-only `git` reads in `/Users/jwloka/Quatico/ewz/ewz-kus-portal`: branch list, worktree list, and `git log origin/develop --grep`. I made no host calls.

## (a) Problem statement

- **The cited code matches.** `runBranchKind` is at `reap.ts:980-1058`. It asks `ctx.refs.contains(br, origin/<default>)` at `:1000` and then `ctx.host.prMerged(br)` at `:1005`. The worktree kind repeats the same pair at `:783-791`. `--dry-run` and `--yes` split only at `:1043`. The plan cites "about `:1000-1050`" at `7c30e136c`, and those lines still hold at `fb90a41c6`.
- **The host can only remove a merged verdict, never invent one.** Reap counts a branch as merged only when `hostMerged.ok && hostMerged.value === 'merged'` (`:1006`). Neither host arm can print `merged` without a row that proves it:
  - GitHub prints `merged` only from `any(.mergedAt != null)` over an answered list (`plot-host.sh:4240`).
  - Bitbucket prints `merged` only from a `state == "MERGED"` row that `bb_branch_query` returned (`:4259`).
  - A failed call goes to `miss_or_unknown` (`:658`), which prints `unknown` or `not-merged`. A page-cap stop exits 3, and `host-shell.ts:308-315` maps that to `unknown`.
  - So a 429 or a partial answer moves a branch toward **keep**.

  The issue's own table fits this. The 6 branches that read `would` in the dry run and were kept under `--yes` lost their merged answer under 429 in the second run. `migration-abw-rechnungsempfaenger` read `keep` in the dry run because its answer there was `unknown`, and it got its true `merged` answer under `--yes`. The issue says its squash content is on develop. **A rate-limited host did not delete that branch. A rate-limited host kept it in the dry run.**
- **The keep reason misnames the cause.** Reap prints `unlanded work — no merged PR` for every `merged === false` (`:1022-1023`). That covers `not-merged`, `unknown`, and a failed call (`!hostMerged.ok`). My probe confirms it: `hasMergedPr:false` returns `"no-merged-pr"`. The port already knows the difference. `MergedAnswer` has `unknown` (`host.ts:33`), and `host.lastRefusal()` carries `kind: 'throttled' | 'secondary' | 'failed'` (`host.ts:87-88`). Reap reads neither, so the dry run told the operator "no merged PR" where the truth was "host could not say".
- **The plan names no host-independent cause for the "merged into develop" rows.** The ancestry answer is deterministic. In ewz-kus-portal, `git log origin/develop --grep 9391` shows `e254ba1945` and `4066340e9e`, so that branch's commits are truly on develop. Two runs disagreeing on it therefore needs another cause, and reap's own order supplies two:
  1. `runReap` runs the worktree kind before the branch kind (`:1268-1269`). The branch kind reads `checkedOut` from `ctx.trees.list()` *after* the worktree kind removed desks (`:988-991`, removal at `:902`). In a dry run nothing is removed, so a branch held by a reapable desk reads `checked-out → keep`. Under `--yes` the desk is gone and the same branch is deleted. My probe shows the flip: `checkedOut:true` returns `"checked-out"`, and `checkedOut:false` returns `null`.
  2. `ctx.fetch(defaultBranch)` runs at the start of each run (`:1245`), so `origin/develop` can move between the two runs.

  The worktree kind's `deleteBranch` at `:911` also explains `branches=38` against `branches=37`: one branch left the list before the branch kind ran under `--yes`. **The plan attributes the whole divergence to the host and #2730. Part of it is reap's own kind ordering, and slice 3 would not touch that part.**
- **The count claim is weaker than stated.** `counters.deleted` rises only with a `deleted` row (`:1049-1051`). `branches=` is `swept`, which also counts `FAILED` rows (`:1042`, `:1053-1054`). The rows printed by the worktree kind (`local branch deleted`, `:912`) are not in `branches_deleted`. That is the more likely source of "the deleted count does not match the rows printed". The plan should name it.

## (b) Approach

- **Slice 3 reads the wrong signal.** "Downgrade a merged verdict made under a rate limit or a partial answer to keep" guards a path that cannot occur: as shown in (a), a limited or partial answer never yields `merged` today. The useful change for this lens is in the opposite direction:
  1. Report `unknown` and `throttled` as their own keep reason, `host could not say (throttled)`, read from `MergedAnswer`/`lastRefusal`, instead of `no merged PR`.
  2. Stop deciding from a host answer bought in this run where the index already holds a terminal one (next point).
- **"A Decision Reads The Index" applies, and the plan does not mention it.** The reaper spends one `pr-merged` call per local branch per run. That is 56 calls in the issue's run, on an account already rate-limited (#2815). `MERGED` is the one terminal answer that the PR index may supply (CLAUDE.md, *Only a terminal answer is read from the index*). `plot-impl-status.sh` and `plot-reconcile-scan.sh` already read it through `board/plot-pr-index-lookup.mjs` / `decodePrIndex`. Reading the store's `MERGED` rows first, and asking the host only on a miss, does two things. Dry run and `--yes` then agree on every indexed branch. Host spend under 429 also falls. The index never says `not-merged`, so a miss still goes to the host, and an `unknown` still keeps the branch. This needs a paragraph in that CLAUDE.md section ("another consumer needs its own paragraph here").
- **"Merged into develop" is acceptable as a reason to delete a local ref, but its licence is wrong.**
  - *One Answer To "Did This Land"* says destructive decisions read the host's `mergedAt` "and nothing else". The measured failure behind that rule is a false **no** (squash-merge). My scratch repo reproduces it: a squashed branch gives `is-ancestor` exit 1.
  - An ancestry **yes** means every commit at the tip is reachable from `origin/<default>`, so deleting the local ref loses no commit. That answers "would deleting this lose work", not "did the PR land".
  - The one false-positive case is a branch with no commits of its own. My scratch repo shows a freshly created `feature/just-created` gives exit 0, so reap would print `merged into develop` and delete a branch somebody just made. The deletion loses no commits, but the reason is a lie.
  - The licence the code relies on does not cover this use. `refs-git.ts:762-764` declares `plot-ancestry: evidence — the caller's age rule decides; a wrong "yes" sends a branch to the host`. Reap applies no age rule and sends a "yes" nowhere: it decides deletion at `:1001-1003` and `:784-786`.
  - `check-ancestry-decisions.sh` reports clean (I ran it: "declared: 10 … clean") because it greps git call shapes, not consumers of `Refs.contains`. **The gate does not see this decision.**
  - The plan should state the reason as its own named domain reading (e.g. `tipOnDefault`), separate from `hasMergedPr`. `sweepable.ts:65-80` folds both into one `hasMergedPr` boolean, so the domain cannot tell them apart today. The plan should either amend the CLAUDE.md section to admit "tip contained ⇒ local-ref delete" as a named exception, or require the host answer as well.
- **The plan does not name a loss path that is host-independent.** `prMerged` answers "has ANY PR for this branch merged" (`plot-host.sh:71`, `host.ts:229-243`). A branch that received commits *after* its PR merged therefore reads `merged`, and the branch kind deletes it. My scratch repo shows such a tip carries a `+` patch that is not on develop (`git cherry`). The worktree kind already guards this case with `prMergedHeads` and `unpushedCommits`/`unpushedPatches` (`reap.ts:436-462`). The branch kind has no such guard. The recorded tip SHA in slice 1 only proves the tip did not move between dry run and `--yes`. It does not prove the tip was covered by the merge. For a destructive verdict, this lens ranks this gap above slice 3.
- **The layering is right in intent.** The decision belongs in `rules/sweepable.ts`, and the entry should pass readings in (`refusal` + `MergedAnswer` + tip SHA + merged heads). Per *Every rendered state is a domain property*, the keep reason text should come from the domain refusal, including a new `merge-unknown` refusal, not from the `switch` at `reap.ts:1018-1030`.

## (c) Slices

- Slice 1 (recorded decision + tip check + counts) is the fix for the operator's complaint, and it also fixes the kind-ordering cause, because `--yes` then acts only on rows the dry run printed as `would`. It should state that the record holds branch-kind rows **and** the worktree kind's `local branch deleted` rows (`:911`). Otherwise the worktree kind still deletes branches outside the record.
- Slice 2 (record the tip before `git branch -D`) is independent and could ship first as the smallest safety net. A ref under `refs/plot/reaped/*` keeps objects from `gc`; a log does not.
- Slice 3 should be replaced. Proposed slice: "the branch kind keeps a branch whose tip is not covered by a merged PR head, and names `unknown`/`throttled` as its own keep reason". It reuses the worktree kind's `prMergedHeads` reading. It does not need to wait on slice 1.
- Optional slice or follow-up: "reap reads `MERGED` from the PR index before asking the host". It needs its own *A Decision Reads The Index* paragraph.

## (d) Open questions

- *Does the host port report rate-limited or partial answers to `prMerged` today?* **Yes, in two places:**
  - `MergedAnswer` has `'unknown'` (`host.ts:33`), and exit 3 maps to it (`host-shell.ts:308-315`).
  - `lastRefusal()` names `throttled`/`secondary`/`failed` (`host.ts:87-88`).

  Reap reads neither and folds both into `no merged PR` (`reap.ts:1006`, `:1022`). No adapter work is needed, only a consumer change. Neither one can produce a false `merged`.
- *Worktree and claim kinds?* The worktree kind uses the same `contains`/`prMerged` pair (`:783-791`) and deletes branches at `:911`, so it shares the divergence. Its unpushed-commit check (`:436-462`) makes it safer than the branch kind.
- New question: should `contains === 'yes'` on a branch with no commits of its own (tip equal to a default-branch commit) be a keep, or a distinct reason such as `no own commits`?
- New question: does `--yes --plan` re-run `ctx.fetch` (`:1245`)? If the recorded decision cites `merged into develop`, the tip check alone is enough, because a moved `origin/develop` cannot uncover a contained commit.

## (e) Tests

- Domain unit (`packages/domain`, vitest), covering `sweepable.ts`:
  - `unknown` merge → refusal `merge-unknown`, not `no-merged-pr`.
  - Merged PR with tip not among the merged heads and patches not on default → keep.
  - `tipOnDefault: yes` with no own commits → the chosen answer.
  - Recorded row with a moved tip → refused.
- Board unit, modelled on `packages/board/test/unit/reap-given-up-desk.test.ts` (real git repo plus fixture `Host`). This needs `runBranchKind` exported, as `runWorktreeKind` already is (`reap.ts:670`):
  - A desk-held merged branch: dry run prints `keep checked-out`, and `--yes --plan` must not delete it after the worktree kind removes the desk. This reproduces the "merged into develop" rows with no host involved.
  - A fixture host whose `prMerged` answers `merged` on the first run and `unknown` on the second: `--yes --plan` deletes exactly the recorded set.
  - Parsing the output: `branches_deleted` equals the count of `deleted` rows, and `FAILED` rows are not counted as `swept` without being named.
- Corpus tier: none needed. No shell duplicate of `firstBranchRefusal` exists.
- Browser: none. The board does not render reap rows.

## Amendments

1. Correct the Cause paragraph. Under 429 the host can only withhold `merged`, never invent it (`plot-host.sh:4240,4259`, `:658`). Name reap's kind ordering (`reap.ts:1268-1269`, `:988-991`, `:911`) and the per-run fetch (`:1245`) as host-independent causes of the "merged into develop" rows.
2. Replace slice 3 with "keep a branch whose tip a merged PR head does not cover (reuse `prMergedHeads`/`unpushedPatches` from `reap.ts:436-462`), and report `unknown`/`throttled` as a named keep reason from `MergedAnswer` and `lastRefusal()`".
3. Split `hasMergedPr` in `LocalBranchReadings` into a host answer (`MergedAnswer`) and a containment answer. State in the plan, and in a CLAUDE.md amendment to *One Answer To "Did This Land"*, that tip containment licenses deleting a **local ref** only. Fix the `refs-git.ts:762` marker, or add a reap-side declaration, because `check-ancestry-decisions.sh` cannot see `Refs.contains` consumers.
4. Make slice 1's record cover the worktree kind's branch deletion at `reap.ts:911` too, not only `runBranchKind`.
5. Add an optional slice or follow-up: read `MERGED` rows from the PR index before `prMerged`, with its own paragraph under *A Decision Reads The Index*.
6. Answer Open Question 3 in the plan as above: the port already exposes it, and reap ignores it.
