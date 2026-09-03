---
'plot': patch
---

The fleet specs say the agent owns both ends of its desk's life, and that the claim push is a backstop rather than the lock. Two sentences are amended, and neither was wrong when written.

**`DESIGN-worktree.md` §1 — the dispatcher no longer creates the desk.** The agent decides create-or-reset when it takes a brief, because it is the only party that can see its own tree: the registry sees identities, the machine sees processes, and neither sees an uncommitted change, a `PLOT-BLOCKED` marker or a checkout holding unpushed commits. The citation also drifted — `plot-dispatch.sh:1908` sits inside the booking region, and the fan-out `git worktree add` is at `:2503` with its fallback attach at `:2505`.

**The measurement that settled it: 2026-09-02, this estate — 2 manifests, 11 worktrees, 8 loop processes, and 5 desks whose branch had already merged.** An identity issued once per agent was being issued once per slice. `DESIGN-agent.md:65` already stated the model the code did not implement.

**`DESIGN-branch.md` §1 — the push is demoted, not deleted.** It was the whole locking mechanism when written and that sentence was accurate: nothing assigned, every agent shopped through `--offline --next`, and git's refusal was genuinely all that prevented a collision. It cannot be removed, because a Branch **is** `refs/remotes/origin/<name>` and git rejects a diverged push whether or not anything intends it as a lock. Once the registry assigns, the same refusal costs nothing and should never fire — the relationship the reaper now has to desks. A firing is a registry bug reporting itself, so it must be loud rather than the silent `continue` the loop used to take. The sentence about a loser asking `--next` again is gone: no agent selects its own work once the registry assigns, so there is no loser to describe.

**Two cross-references outside the branch's two files were amended with it**, because each restated an amended sentence rather than citing it: `DESIGN-agent.md` §*It owns its desk* repeated *"the dispatcher creates the tree"*, and `DESIGN-machine.md` §10 quoted *"the whole locking mechanism"* as current. Both now name it as the earlier reading. The third occurrence, `DESIGN-agent.md:185`, is left as it stands — it uses the quote only for the property that survives the demotion, that a claimed branch is a fact rather than a forecast.

`DESIGN-worktree.md` §*`WorktreeManager`* no longer states as current that a worker creates its own next tree; the row is dated to the 2026-08-28 measurement it came from.

<!--
bumps:
  skills:
    plot: patch
-->
