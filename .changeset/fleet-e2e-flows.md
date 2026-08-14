---
"plot": patch
---

End-to-end flow tests for the parallel fleet.

The unit tests check each fleet script against a hand-built fixture. These five flows check that the scripts actually feed each other on real refs in sandbox repos: a wave-structured plan is read with its waves, `--next` names a branch from it, `plot-dispatch` claims that exact branch, the pulse then reports it as claimed, and the merge queue orders what comes out.

The wave transition is the part no unit test can reach — "wave 1 merges, wave 2 becomes eligible" is a property of git state changing *between* two runs of a stateless command, which only a flow test can stage. It was previously verified only by hand.

Also covered: a second dispatcher cannot steal a claimed branch or duplicate its worktree; the phase gate refuses a Draft plan before anything is created (including when the script is called directly, which is how skill prose gets bypassed); and the merge queue reports a collision against the branch *ahead of it in the queue* rather than against main, without advancing `origin/main`.
