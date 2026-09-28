Position: amend
Evidence: executed

# EVIDENCE lens — a post-merge commit is not merged work (#1038)

## The premise is TRUE, and I reproduced it

I built the fixture the brief asked for and ran the real `plot-reap.sh` against it. Probe at `/tmp/j2fix/probe.mjs`, modelled on `test/reconcile/reap-agent-liveness.test.mjs`'s own harness (`makeRepo`/`desk`/`stubGh`/`runReap`), with the remote branch deleted and pruned as the host leaves it:

```
branch feature/post-merge-commit, gh stub: mergedAt 2026-09-27, headRefOid = 0*40 (a sha the desk never had)
desk holds a commit authored 2026-09-28T12:00:00Z, existing on no ref anywhere

LINE: reaped   feature/post-merge-commit    PR merged (squash)
late commit: c867566   worktree exists after --yes: false
```

The desk was removed under `--yes` and the post-merge commit went with it. So the motivation is not a hypothetical, and the three jurors' 2–1 measurement is reproducible. **Nothing below disputes that there is a real defect.**

## Four claims a measurement contradicts

### 1. "Both reading sites are covered — `plot-reap.sh:506` and `:1040`" — both line numbers are wrong, and the second is not a reading site at all

Actual call sites, from `grep -n` on the file (1166 lines):

- `plot-reap.sh:626` — `elif [ -n "$short" ] && pr_merged "$short"` (the worktree loop's merge reading)
- `plot-reap.sh:653` — `if unpushed=$(desk_unpushed "$wt" "$short" "$merge")` (the ONLY `desk_unpushed` call in the file)
- `plot-reap.sh:919` — `elif pr_merged "$br"` (the local-branch sweep)

`:506` is prose inside a comment block about vanished worktrees. `:1040` is inside the `-- orphaned claim refs --` loop, which calls `sweep_is_empty_claim` and touches neither function.

This is not a citation nitpick, because **the site the plan is pointing at cannot consume the fix.** `:919` is the local-BRANCH sweep: there is no worktree, no `HEAD` to `rev-list`, and no commits to date-compare. It asks `sweep_branch_verdict` → `firstBranchRefusal`, which lives in `packages/domain/src/rules/sweepable.ts:99` — a **different rule in a different file** from `reapProblems` (`rules/reapable.ts:100`). `LocalBranchReadings` has no `unpushed` field and nothing analogous.

So the Done-when line *"Both reading sites are covered — `plot-reap.sh:506` and `:1040` — asserted by a test driving the sweep's counter"* asks for a test of something the design does not reach. An implementer will either write a vacuous test or widen `sweepable.ts` for no reason. **There is ONE reading site: `plot-reap.sh:653`.**

### 2. "the fix costs no extra host call" — as specified, it costs a THIRD call per desk

The plan is right that `mergedAt` is fetched and discarded twice:

- `plot-pr-merged.sh:126` — `gh pr list --head "$br" --state all --limit 100 --json mergedAt`, reduced to `found`/`none` at `:128`
- `plot-pr-merged.sh:199` — `gh pr list --head "$br" --state all --limit 100 --json mergedAt,headRefOid`, and `:205`'s node filter emits `r.headRefOid` only

Both quoted verbatim. But there is **no caching anywhere in `plot-pr-merged.sh`** — I grepped for it, zero hits. Each of those is a live `gh` call, and today the reap loop makes two per desk (`pr_merged` at `:626`, then `pr_merged_heads` inside `desk_unpushed` at `:653`). The design says *"a `pr_merged_at` beside `pr_merged_heads`, in the same sourced helper"*. A third sibling function with the same body shape is a **third** `gh pr list` per desk — a 50% increase on the reaper's host budget, not zero.

The cheap version exists and the plan does not name it: `pr_merged_heads` already fetches `mergedAt,headRefOid` in one call and throws the first field away at `:205`. **Widen that emit to `headRefOid\tmergedAt` and the cost really is zero.** That is a different slice shape from the one the plan specifies, and the difference is the whole "cheap part is that the data is already bought" argument.

### 3. "`pr_merged_at` … so the reaper and `plot-release-refs.sh` cannot disagree about it" — release-refs has no use for it

`plot-release-refs.sh:113` sources the helper and uses `pr_merged` (`:213`) and `pr_open`. It has no unpushed reading and no desk. The plan itself says under *What this does NOT do*: **"It does not touch `plot-release-refs.sh`'s guards."** Both cannot be true. The co-location argument names a consumer that will not consume, so the stated reason for putting the function in the shared helper is empty — which matters, because it is the reason offered for adding a third function rather than widening the one that already fetches the field.

### 4. "It does not change `reapProblems`" — true, and the plan should say what it *does* change

`reapProblems` (`rules/reapable.ts:100-124`) takes `unpushed?: readonly string[] | 'unknown'`. The fix narrows what the adapter puts in that array, so the rule is genuinely untouched. **That means the entire date rule lives in bash**, in `desk_unpushed`, with no domain test and no corpus entry. The plan never says so. Given `CLAUDE.md`'s *A Shell Script Asks The Domain* — a script running **once per operator command** calls the domain, and `plot-reap.sh` already imports `reapable.ts` directly at `:684` — a date comparison written as shell `[[ "$d" > "$m" ]]` is a rule nothing can test in TypeScript. The slice must state whether the comparison goes in the domain or stays in shell, and why.

## The sharpest question: author date or committer date. NEITHER is safe, and I measured both failing

The plan says *"The slice states which it reads and why, against a fixture that rebases."* I built the fixtures. The answer is that **each field has a failure the other does not, and both are reachable on this estate.**

Baseline, `/tmp/datetest`: a plain rebase leaves `%aI` at `2026-09-10T10:00:00Z` and rewrites `%cI` to now. Confirmed.

**`%cI` gives a FALSE KEEP THAT NEVER CLEARS** — `/tmp/rebasemerge`:

```
branch work authored 2026-09-20, pushed, squash-merged at mergedAt=2026-09-21
agent then rebases the desk onto the advanced main (routine here)

be5c8a7  aI=2026-09-20T10:00:00Z  cI=2026-09-28T18:11:30+02:00  "the work"

%aI: 09-20 < 09-21  -> REAP   (correct — this work merged)
%cI: today > 09-21  -> KEEP   (WRONG — and it is permanent)
```

Permanent is the operative word. The desk holds only merged work, and every subsequent rebase re-stamps `%cI` forward. **Nothing ever clears it.** That is the plan's own listed non-goal — *"That is the defect #1033 fixed, and it holds every squash-merged desk on the estate forever"* — reached by the fix rather than avoided by it. The plan says the rule "fails toward keeping" as if that were free; it is free for an *unreadable* reading, and it is not free for a *readable and wrong* one.

**`%aI` gives a FALSE REAP that loses work** — `/tmp/cherrycase`:

```
a commit MADE today from an old patch (cherry-pick, `git am`, rebase of never-pushed work)
aI=2026-09-10T10:00:00Z  cI=2026-09-28T12:00:00Z,  mergedAt=2026-09-21

%aI: 09-10 < 09-21 -> REAP.  The commit was made today and exists nowhere. Work lost.
%cI: today > 09-21 -> KEEP.  Correct.
```

So `%aI` reintroduces exactly the defect this plan exists to fix, in a narrower population.

**This estate's own rate**, `git log -200` on main: **17 of 200 commits (8.5%) have `%aI ≠ %cI`**, 2 of 200 with `%aI` earlier than `%cI`. The divergent population is not rare here.

The plan's sentence *"The post-merge case the panel measured was a plain commit on a desk, where both agree"* is true and is the trap: the panel measured the ONE shape where the choice does not matter, so no reading of the panel's evidence can settle it.

## Does the date fix even solve the subject case? Yes — and that is worth stating

On `/tmp/squashtest` and the pruned-remote variant, both fields are readable inside the reaper's shape:

```
git rev-list --abbrev-commit HEAD --not --remotes  ->  a486806 14e1619
git log --no-walk --format='%h %aI %cI' <those>    ->  a486806 2026-09-28T12:00:00Z 2026-09-28T18:10:47+02:00
```

So the mechanism is reachable with no new git call — `rev-list` can carry `--format` directly. The plan's mechanism works. Its unresolved question is which field, and the honest answer my fixtures give is **neither alone**.

## What it must say before someone builds it

1. **Fix the reading sites.** One site: `plot-reap.sh:653`. Delete `:506` and `:1040`, and delete the Done-when clause asking for a test "driving the sweep's counter" — the sweep at `:919` reads `sweepable.ts`'s `firstBranchRefusal`, which has no unpushed reading and is out of scope.

2. **Retract or requalify the zero-cost claim.** As written (a new sibling function) it is a third `gh pr list` per desk. Name the actual cheap route: widen `pr_merged_heads`'s node emit at `plot-pr-merged.sh:205` from `r.headRefOid` to a `headRefOid\tmergedAt` pair, so the already-bought field is used rather than re-bought.

3. **Decide the field against BOTH fixtures, and say what the losing case costs.** A fixture that only rebases is insufficient — it shows `%aI` surviving and says nothing about the false keep. The slice needs the pair above: the post-merge rebase (`%cI` keeps forever) and the old-patch commit (`%aI` reaps live work). My recommendation, offered as a juror and not as a decision: read **`%cI`** and bound the false keep, because a permanent stale checkout is recoverable by a person and lost work is not — but the plan must then say how the false keep clears, or it has traded #1033's forever-hold for a narrower forever-hold and should say so plainly in the Changelog.

   The alternative worth one paragraph in the plan: **`max(%aI, %cI) > mergedAt` keeps.** It passes both of my fixtures — `%cI` catches the old-patch commit, `%aI` cannot rescue the rebased-merged one but `%cI` there is the false keep… so it does NOT fix the false keep, only the false reap. State that and choose knowingly.

4. **Say where the comparison lives.** `plot-reap.sh` already imports `reapable.ts` (`:684`) and `reapProblems` is untouched by design, so the date rule defaults into untested bash. Name the choice.

5. **Drop the `plot-release-refs.sh` co-location argument** or replace it with a real one. That script sources the helper but has no unpushed reading, and the plan's own non-goals say its guards are untouched.

## What executing revealed that reading would not

- That the defect is real and the removal is silent — the output line reads `reaped … PR merged (squash)` with no mention of the commit. A reader of the code alone would suspect it; the fixture proves it.
- That `%cI`'s false keep is **permanent and self-renewing**. Reading the plan's "fails toward keeping" sentence, that reads as a conservative default. Running the rebase-after-merge fixture shows it is `#1033`'s forever-hold returning under a different field, which is the plan's own named non-goal.
- That `%aI` has a mirror failure that loses work, so the plan's framing — *decide which field, the fixture will tell you* — has no winning answer to find. Only executing both shapes shows there is no single-field answer.
- That `:1040` is a different rule in a different domain file. Reading the plan, "both reading sites" sounds like a completeness requirement; opening `plot-reap.sh:919` and following it to `sweepable.ts:99` shows it is scope that does not exist.
- That `plot-pr-merged.sh` holds no cache, which is what turns "already bought" from a fact about the data into a false claim about the cost.

## Files cited

- `/Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/plot-reap.sh:241` (`desk_unpushed`), `:247`, `:626`, `:653`, `:684`, `:919`
- `/Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/plot-pr-merged.sh:120` (`_plot_merged_lookup`), `:126`, `:196` (`pr_merged_heads`), `:199`, `:205`
- `/Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/plot-release-refs.sh:113`, `:213`
- `/Users/jwloka/Quatico/Agentic-Tools/plot/packages/domain/src/rules/reapable.ts:100-124`
- `/Users/jwloka/Quatico/Agentic-Tools/plot/packages/domain/src/rules/sweepable.ts:99`
- `/Users/jwloka/Quatico/Agentic-Tools/plot/test/reconcile/reap-agent-liveness.test.mjs:227-252` (the squash-merge test the plan references)
- `/Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/plot-fleet-scan.sh:2437` — the estate's existing precedent for a future-dated commit, clamping rather than trusting the clock; the plan should cite it
