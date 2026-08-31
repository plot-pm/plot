---
'plot': patch
---

A worker hops, and there is now evidence it does.

`plot-worker-loop.sh` has always been able to finish one slice and start the
next: it loops, asks `--next` for the following branch of the same plan, creates
the worktree, claims the ref and rewrites its manifest. **None of that had ever
run.** On 2026-08-30 seven workers exited 124 and not one reached the `--next`
call, because the wall-clock bound killed them first — the loop's own message
said so: *"ending worker without hopping"*. The path was written, reviewed,
merged and unexercised.

`test/e2e/worker-hops.test.mjs` is the first evidence it works at all. Three
flow tests, all asserted from **outside** the script: one worker runs its prompt
on two branches in sequence and the hop creates the second worktree and pushes
its claim; the manifest during the second slice names that branch and worktree
with `wavesCount` 2 while `session`, `pid` and `startedAt` do not move; and a
worker whose `--next` says *nothing to start* exits 0 and deregisters.

**Never by reading the loop's source.** *"The function that would hop is called"*
is what a green suite over a dead path looks like, and this repo already ships
one such assertion. The evidence here is a file the worker's own prompt appended
to once per slice.

Two fixture findings, both measured while writing it:

- **The landing must be a merge commit.** Pushing a branch tip straight onto the
  default branch leaves both at one oid, which `branch_state` reads as `open` —
  deliberately, since *reset to main* and *merged* are indistinguishable by
  ancestry. A fast-forward fixture never opens wave 2, so the worker never hops,
  which reads exactly like the hop being broken.
- **The manifest cannot be read after the run.** `_cleanup_on_exit` removes it on
  every exit path, so the only observer alive during the second slice is the
  agent itself; the snapshot is taken from inside the prompt, and what it reads
  is the registry entry a board would have rendered at that moment.

Verified by mutation rather than by passing: disabling the hop fails 2 of 3,
skipping the manifest update fails exactly 1, and making *nothing to start* an
error fails all 3.

<!--
bumps:
  skills:
    plot: patch
-->
