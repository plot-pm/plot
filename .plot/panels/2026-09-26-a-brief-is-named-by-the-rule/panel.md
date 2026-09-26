# Panel — a brief is named by the rule

**One lens, amend, executed.** Round 1. The juror both measured the history and built the proposed gate.

## The defect is real and larger than the plan said

**25 misnamed briefs, not 12.** Across **21 distinct commits**, 2026-08-24 to 2026-09-26. The plan counted survivors on `main`; the history holds the rest — renamed, deleted, or carried off on merged branches.

```
$ git log --all --diff-filter=A --name-only --format='' -- '.plot/briefs/*' \
    | grep -E '^\.plot/briefs/(feature|bug|infra|docs|idea)-' | sort -u | wc -l
25
```

Verified by the moderator: **25 of 530 briefs ever added — 4.7% — and 7 in August against 18 in September.**

**This strengthens the plan's argument and weakens its framing.** Two commits reads as a slip; twenty-one accelerating over a month is a convention degrading under load, which is the case for a gate rather than a reminder.

## The gate works — prototyped and run

Three cases in a scratch repo:

```
add    .plot/briefs/another-good-one.md         → exit 0   allowed
add    .plot/briefs/bug-the-thing-broke.md      → exit 2   refused, names expected path
git mv a-good-name.md → feature-a-good-name.md  → exit 2   refused
```

**A `git mv` is visible to the hook**: the rename reaches the staged index as `R100 <old> <new>`, `-M` surfaces it. The plan's *"adds or renames"* wording is achievable, proved rather than assumed.

**The route is the existing one** — `plot-state-gate.sh:57` reads `.tool_input.command` only to identify a commit, then reads the index. **Zero false positives over the whole estate.**

## Recommendation

**Amend, and the plan has been rewritten.** The design survives the panel intact; what changed is the measurement behind it and the evidence that the gate is buildable. This is the first plan today whose proposed mechanism a juror verified by constructing it.
