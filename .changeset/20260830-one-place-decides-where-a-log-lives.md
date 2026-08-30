---
'@plot-pm/board': patch
---

One place decides where an agent log lives.

Nine board modules each hard-coded `path.resolve(repoRoot, '..')` to place their
log, prompt and state files — **one decision written 22 times**. `agent-log.ts`
is now that decision, and the nine ask it.

**The returned path does not change.** Moving the logs and moving the decision
in one diff would mean a reviewer cannot tell a missed call site from an
intended path change; the move is its own slice. All 22 forms were verified
byte-identical against the pre-refactor expression.

**The 22nd call site is the one the grep missed.** `idea.ts` resolves a worktree
DIRECTORY rather than a log file and spells it `opts.repoRoot`, so it did not
match the pattern the plan states as its assertion. `agentLogDir` is exported
for it — without that split it would have had to fake a filename, which is how a
call site drifts back to hard-coding.

**Readers came along for free.** `auto-deliver.ts` and `auto-dispatch.ts` read
these logs and are not among the 22 writers, but both already went through the
exported helpers. A missed reader is worse than a missed writer — the writer
puts a file somewhere unswept, while the reader looks in the wrong directory and
reports nothing wrong — and one expression covers both where two lists drift.

`AgentLogKind` is a closed union rather than a string, because these names are
also what a sweep globs for: a tenth module inventing `plot-audit-*.log` would
write a file no cleanup knows to remove.

The grep is a test rather than a note. 22 call sites is exactly the kind of
change where one gets missed, and the missed one keeps writing to the old
location where nothing will ever clean it.
