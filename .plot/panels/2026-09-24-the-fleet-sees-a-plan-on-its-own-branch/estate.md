# Estate lens — the-fleet-sees-a-plan-on-its-own-branch

Position: amend

## Summary

Every code claim the plan makes is TRUE. I verified each one by reading the cited lines and by running the scan. Nothing has already shipped: `git log -S 'readBranchPlans'` shows the board-side work landing in `01d68169c` / `7a0ac4bbf` and touching `packages/board/src/server/board.ts` only — `plot-fleet-scan.sh` was never given the same reading. The defect is real and the direction of the fix is right.

I amend rather than proceed on three findings: **the scan's cited cost is wrong by 3x and it is the number the slice's own gate is written against**, **the plan's transfer story understates the work** because the scan's enumeration is structurally different from the board's, and **the dedup the plan calls "the hard part already solved" is not the dedup the scan needs**.

## Verified claims

### `board.ts:808-813` — TRUE, exactly as quoted

`packages/board/src/server/board.ts:808-816`:

```ts
const onDefault = await planPathsInTree(refs, `origin/${defaultBranch}`, planDir);
const plans: BranchPlan[] = [];
const seen = new Set<string>();
for (const { branch } of branches) {
  for (const relPath of await planPathsInTree(refs, `origin/${branch}`, planDir)) {
    if (onDefault.has(relPath) || seen.has(relPath)) continue;
```

The dedup comment the plan quotes is at `:810-812` verbatim ("a card per branch would report one plan as several"). Confirmed.

### `plot-fleet-scan.sh:122` — TRUE

`skills/plot/scripts/plot-fleet-scan.sh:122`: *"Plans are enumerated from `origin/<main>` (`git ls-tree`/`git show`), NOT from the working tree"*. The implementation backs the comment: `:2457` `ref_ls()` runs `git ls-tree -z --name-only "origin/$MAIN"`, `:2508` `PLAN_MODES` runs `git ls-tree -r "origin/$MAIN"`, and the candidate loop at `:3007-3014` reads `ref_ls "$PLAN_DIR"` and nothing else. **No branch other than `origin/$MAIN` is ever consulted for a plan file.** Confirmed.

### `Impl: same branch` produces the described shape — TRUE

`skills/plot-idea/SKILL.md:314-322`:

- `Review: pr` + `Impl: same branch` — "the work branch (`feature/<slug>` or type-appropriate prefix) is created instead, the plan is its first commit"
- `Review: in-session`/`ballot` + `Impl: same branch` — "the plan rides the work branch ... the plan file is its first commit. No idea branch exists in this flow."

So the plan file lands on a prefixed work branch and reaches `origin/main` only when that branch merges. The scan cannot see it. The mechanism is confirmed, not inferred.

### The board really does cover this population

`prefixedBranches` (`board.ts:695-728`) globs `refs/remotes/origin/<prefix>*` for every configured prefix. This repo's `Branch prefixes` is `idea/, feature/, bug/, docs/, infra/`, so a `feature/`- or `bug/`-prefixed work branch IS in the board's population. The plan's "the Board tab is already correct" holds.

## Reproduction attempt — HONEST NEGATIVE

I swept every remote ref for plan files `origin/main` lacks:

```
0  origin/bug/the-index-is-read-once
3  origin/feature/one-monitor-watches-the-slice
      docs/plans/2026-08-18-the-repair-exists-report.md
      docs/plans/2026-08-23-an-eligible-wave-starts-itself-notes.md
      docs/plans/kanban-board-v1-open-questions.md
0  origin/feature/the-domain-knows-a-round
```

The three files on `feature/one-monitor-watches-the-slice` are **not plans** — none carries a `State:` field (they are a report, worker notes, and a decision log). `add_plan_by_phase` (`:2986`) gates on `is_plan_phase "$ph"`, so all three would be rejected by both readers anyway. The `fork/*` refs carry two old `docs/plans/active/` files but those are a stale fork remote, not this estate's work.

**So the symptom is NOT reproducible here, and the plan already says so** ("not currently observed, because every plan here reaches `origin/main` through a PR", Notes). I confirm that admission is accurate rather than an excuse — it is the correct reading of this estate. The defect is reported from an external install and the mechanism is proved by reading, which for this one is sufficient because the mechanism is a missing call, not an inferred behaviour.

## Finding 1 — the cost number the slice gates on is wrong by 3x

The plan's cost section says *"The scan is **18.3 s**"* and builds the whole narrow-if-too-expensive gate on it. I ran it:

```
$ skills/plot/scripts/plot-fleet-scan.sh --json
exit=0 elapsed=58.789273000 s
plans: 17, branches in pulse: 22, plan_source: ref
```

**58.8 s, not 18.3 s.** The 18.3 s figure traces to `CLAUDE.md:198` and `plot-fleet-scan.sh:2957`, both of which are older measurements. The plan copied a documented number instead of taking one — which is the failure mode this panel exists to catch.

This matters *because the plan makes the number load-bearing*: "If the cost is unacceptable the fix narrows". A slice told to compare against 18.3 s will read its own 59 s baseline as a catastrophic regression it caused. **Amend: the slice must take its own before-number and state the machine and load, not inherit one from prose.**

### And the added cost is negligible, which the plan does not know

The work the fix adds, measured directly:

```
branch count: 15
per-branch ls-tree total: 0.239 s
```

**0.24 s against a 58.8 s scan — 0.4%.** The plan's fear ("multiplies the git work by the branch count") is quantitatively unfounded here. The scan already spends its time on per-branch host round trips and `rev-list`, not tree reads. The whole "narrow to PR-less branches if the cost demands it" escape hatch is contingency for a cost that does not exist at this estate's size. It is not wrong to keep it, but it should not shape the design.

### The branch count is also wrong

The plan says "28 branches on the reporting estate, 54 here". This estate has **15** remote refs total, **4** under `origin/`, **3** prefixed. The 54 appears to be inherited from `CLAUDE.md:198`'s "26 of 54 here", which counts *branches named in plans*, not refs to walk. The population the fix walks is the prefixed-ref set — 3 here — not 54.

## Finding 2 — the dedup is real but it is not the scan's problem

The plan says the board's `onDefault`/`seen` pair is "the hard part already solved" and "must be copied, not re-derived". I disagree on the emphasis.

`onDefault` is trivially necessary and any implementation gets it right. `seen` guards against *two branches carrying the same plan file* — which happens in the board because it stages plan CONTENT into a temp dir and parses each staged file as a card. **The scan's shape is different.** Its candidate list (`:3007-3014`) is keyed on the path in the ref, and `parse_plan_estate` (`:3026`) is a single batch invocation over the whole list. A duplicate path would need to be deduped before that batch call — which is one `seen` set in the candidate loop, the same three lines, but sitting in a different place for a different reason.

More importantly: **the scan's real difficulty is not dedup, it is the ONE-INVOCATION parse.** `:3002-3005`: *"THE CANDIDATE LIST IS BUILT BEFORE ANYTHING IS PARSED, because the estate is parsed in ONE call and a single call needs its whole argument list. In ref mode that means every blob is materialized first."* Adding branch plans means materialising more blobs into `$REF_TMP` before the batch — and `ref_plan_file` is hardcoded to `origin/$MAIN` throughout (`:2575` `git ls-tree "origin/$MAIN"`, the `120000` symlink resolution at `:2569-2600`, and `PLAN_MODES` at `:2508`). **Every one of those must become ref-parameterised.** That is the actual work, and the plan does not name it.

**Amend: the slice's brief should name `ref_plan_file`, `ref_ls`, `ref_mode_of` and `PLAN_MODES` as the functions that need a ref parameter**, and say that the symlink-in-ref-space resolution (`:2569`) must work against a branch ref too. Otherwise an implementer reads "copy the dedup" and misses that four helpers are single-ref by construction.

## Finding 3 — an attribution gap the plan states as solved

"Done when" includes: *"A branch whose tree holds a plan file the default branch does not carry is reported with that plan's slug and phase."*

But the scan does not attribute branches to plans by looking at branches. It reads the plan's `## Branches` section and walks outward (`:3820-3832`, driven by `plan_meta_waves`). So a same-branch plan is seen **only if the plan file names its own branch under a wave heading.** If it does, the fix works and the row gets its slug. If it does not — and a small `Impl: same branch` change is exactly the ceremony-light case least likely to write a `## Branches` section — the plan becomes visible as a plan while its branch stays a plan-less row, i.e. #973's population, not this one's.

The plan's final Done-when bullet gestures at this ("A branch with no plan anywhere still reports `plan: \"\"`") but that is a different case. **Amend: state whether a same-branch plan that does not name its own branch is in scope**, and if the answer is that `/plot-idea` always writes the branch line, cite where.

## What I checked for prior art — nothing has shipped

- `git log --oneline -S 'planPathsInTree'` → 5 commits, all board-side (`7a0ac4bbf plot-board: source plan files from prefixed branches too`, `01d68169c board: read plans and sprints from the ref, not the checkout (#469)`).
- `git log --oneline -S 'readBranchPlans'` → same cluster, board-only.
- `docs/plans/2026-08-16-fleet-sees-local-work.md` is **Released** and is a *different* defect: uncommitted local work reading as quiet. No overlap with branch-borne plan files.
- No plan or issue in `docs/plans/` addresses scan-side branch plan enumeration. The gap is genuine.

The plan's own framing — "the fifth ticket today whose fix is *one of two readers already does it right*" — is accurate and is the strongest argument for it.

## Position rationale

Proceed is wrong because the plan hands its slice a cost baseline that is off by 3x on the very measurement it demands, and a branch count off by an order of magnitude. Reject is wrong because the defect, the mechanism and the direction are all verified true and nothing has shipped.

Amend, with four concrete changes:

1. **Replace 18.3 s with a measurement taken on the branch.** Measured here: 58.8 s. State machine and load.
2. **Correct the branch count** — 15 refs / 3 prefixed here, not 54 — and record that the added `ls-tree` work measures 0.24 s (0.4%). Demote the "narrow to PR-less branches" escape from a design driver to a contingency.
3. **Name the four single-ref helpers** (`ref_ls`, `ref_mode_of`, `ref_plan_file`, `PLAN_MODES`) as the work, and the one-invocation `parse_plan_estate` constraint as the shape the fix must fit. "Copy the dedup" understates it.
4. **Resolve the attribution case**: a same-branch plan that does not list its own branch under a wave heading.

None of these changes the slice's identity or its branch. They change what the implementer is told to measure and touch.
