# Evidence lens — a correction is not unlanded work

Position: proceed
Evidence: executed

## What I ran

### The premise holds: `PLOT-CORRECTION.md` is NOT git-ignored

```
$ git check-ignore -v PLOT-CORRECTION.md
exit=1            # no rule matches
$ git check-ignore -v PLOT-BLOCKED.md
exit=1
```

This was the premise most likely to be false — an ignored file is one the reaper never sees, and the plan's own Design section flags `.gitignore` as the possibly-better fix. It is not ignored, so the reaper does see it. **Premise confirmed.**

In a scratch repo I made the exact tree the plan describes:

```
$ echo body > PLOT-CORRECTION.md
$ git status --porcelain | grep -v 'tiny-garden/\.plot/state' | head -1
?? PLOT-CORRECTION.md
```

That string is `dirtyPath`. In `reapable.ts:95-97` the test is `readings.dirtyPath !== ''`, so a correction-only desk pushes `uncommitted-changes` and is kept. **The refusal the plan describes is real and reproduced.**

### The tooling-state path is TRACKED, which is why `.gitignore` will not fix it

```
$ git ls-files | grep .omc
packages/board/.omc/state/last-tool-error.json
$ git check-ignore -v packages/board/.omc/state/last-tool-error.json
exit=1
$ grep -n omc .gitignore
18:.omc/
```

`.omc/` IS in `.gitignore` and the file is still tracked and still reported — a gitignore rule does not apply to a tracked path. This is why the measurement shows ` M` (modified) rather than `??`. **So the slice's "consider `.gitignore` first" instruction is answerable but the answer is no**: the fix is `git rm --cached`, or the named exclusion. The plan leaves this as the slice's argued choice, which is the right ceremony, but the slice should be told the file is tracked — otherwise it will add an ignore rule, observe no change, and be confused.

Corroborating: the merge that shipped #1018 carries a commit *"board: leave the tool-error state file to whatever wrote it — swept into this branch by a `git add -A`. It is agent tooling state, tracked on main."* The estate has already hit this file once and worked around it by hand. That strengthens the plan.

### The `PLOT-BLOCKED*` claim is true, verified in source

`reapable.ts:48-49,92-93,139-140,369,443` — `blockedMarker` is its own field and its own `'blocked-marker'` refusal, separate from `uncommitted-changes`. The loop agrees: `plot-worker-loop.sh:561-563` — *"IT IS A `PLOT-CORRECTION` FILE AND DELIBERATELY NOT A `PLOT-BLOCKED*` ONE ... a correction owes [a person nothing]"*, and `correction_file_name()` at :543 is the single writer. **The distinction the plan builds on already exists in both halves.**

### The precedent the plan does not cite, and should

An exclusion list ALREADY EXISTS, at `plot-reap.sh:521-522`:

```
dirty=$(git -C "$wt" status --porcelain 2>/dev/null \
          | grep -v 'tiny-garden/\.plot/state' | head -1)
```

with a comment (:511-518) that argues the identical case: *"the tiny-garden pulse is excused because every board suite rewrites it — a worker that did nothing but run the tests would otherwise never be reapable. Any OTHER dirty path is still reported, which keeps this an exception rather than a hole. It is filtered HERE, in the reading, because it is a fact about this repository's fixtures and not about whether a worktree may go."*

This is decisive, and it strengthens the plan twice over:

1. **The mechanism is settled.** One `grep -v` in the reading, not a rule change. The layering question — filter in the reading or in the rule — is already answered by the estate with a stated reason, and the plan's instinct ("named, never a pattern") matches it.
2. **The second filter site is `plot-reap.sh:1035`**, the dirty-trees sweep, which carries the same `grep -v` independently. **The plan does not mention it and the slice will miss it.** Excluding the correction at :521 but not :1035 leaves a reaped desk still counted in `dirty_trees=` and printed under *"dirty trees nobody owns"* — a finding about a file the reaper just decided does not count. Both sites or neither.

### The perverse-consequence argument survives

24 lines in `.plot/state/unowned-action-writes.tsv`, all 24 `dispatch` — consistent with the session the plan describes. The composition claim (correction + tooling file + pid-less desk = three manual acts) is coherent with `reapProblems` pushing independent refusals, and the pid half is correctly deferred to #1015.

## Where I would amend, short of withholding

Three notes for the slice, none of which changes the decision:

- **Name both filter sites.** `:521` (the reap reading) and `:1035` (the dirty sweep). The "Done when" clause *"a desk with any other uncommitted file is still kept, and the refusal still names the path"* does not cover the sweep's counter, so a passing test suite can still leave the defect half-fixed.
- **State that the tooling file is tracked**, so the `.gitignore` consideration reaches the right answer (`git rm --cached`, or name it) instead of a no-op ignore rule.
- **The exclusion is a whole-line `grep -v`, and `PLOT-CORRECTION.md` at a desk root is `?? PLOT-CORRECTION.md`.** A pattern anchored wrongly would also match `docs/PLOT-CORRECTION.md` or a path containing that name. The plan's "closed and named, never a pattern" rule should extend to anchoring the match, since the whole safety argument is that no source file can be caught.

None of these is a reason to reject. The premise is measured true, the mechanism already exists with a precedent that argues the same case, the blast radius is one named path plus one tracked file, and the refusal it weakens keeps its teeth for everything else.

## Position

Position: proceed
