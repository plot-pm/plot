---
'plot': patch
---

A reaped worktree takes its log.

`plot-reap.sh` removed the checkout and the registry manifest and left the agent
log where it was. **Measured 2026-08-30: 190 log files, 2.6 MB beside the
repository, the oldest from 2026-08-17, and not one belonging to live work** —
all five active worktrees had none. Nothing had ever removed one, so a finished
agent's last act was to leave a file nobody would ever open again.

The log goes last, after the manifest. The first two are ordered because the
reverse leaves a live worktree unregistered, which the registry answers by
synthesizing an `unknown` row. The log is last because it is the only one that
is **pure cleanup**: a missing manifest orphans an agent, a missing worktree
loses a desk, and a missing log costs a record of work the host already merged.
So a failure before it has cost the least, and its own failure costs nothing.

**A missing log is not a refusal.** The five refusals guard work that might be
lost; a log describes work that has already landed. `rm -f` semantics — not
being there is the desired state, and the report says nothing rather than
claiming a removal.

**Which log, since the estate holds two shapes of one.** `plot-resolve-<branch>`
is keyed by branch with its slashes flattened, so it maps one-to-one onto the
worktree being removed, and its `.state` and `.prompt.md` go with it — a sweep
taking the log alone leaves two thirds of a run behind. The per-plan
`plot-dispatch-<slug>.log` is deliberately **not** swept: `dispatch.ts:150`
opens it for append across every dispatch of a plan, so reaping one branch of a
five-branch plan would delete the record the other four are still writing to.
A test asserts it survives.

The directory comes from the same `Worktree root` key `resolve_wt_root()` and
`agentLogDir` read, falling back to the parent directory rather than erroring —
a repository that never migrated is exactly the one with logs to clean.

**The five refusals are asserted unchanged**, because this slice edits the
script that holds them and they are the only thing standing between a cleanup
and losing work. 18 tests in `test/reconcile/reap-log.test.mjs`, verified
discriminating by mutation: stubbing the log lookup back to its pre-fix
behaviour fails exactly the five log-behaviour tests and leaves every refusal
lock green.

`workflows/reap.ts`, transcribed from the script, gains a matching `log-clear`
write so the domain does not describe a two-write reap the script performs in
three.

<!--
bumps:
  skills:
    plot: patch
-->
