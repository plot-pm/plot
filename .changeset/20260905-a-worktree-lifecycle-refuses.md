---
'@plot-pm/board': patch
---

A desk's lifecycle is a rule that refuses, joining the story's (#707) and the agent's (#710). `transitions/worktree.ts` transcribes `diagrams/worktree-lifecycle.mmd` and refuses anything the diagram does not draw — including `finished -> gone`, the move that would remove a checkout without measuring it. `created -> finished` stays, because the diagram draws it: the hand-made tree with no claim ref reaches `finished` without a worker ever running in it.

`finished -> reapable` is the one move the diagram labels rather than decides — *"every refusal empty"* — so it asks `rules/reapable.ts` instead of re-deriving it. The reaper already reads that rule and holds no judgement of its own, and two implementations of *may this be removed* is the drift that deletes somebody's work. Supplying no readings for that move refuses: *nobody looked* is not *every refusal passed*, the direction the rule already fails in when the host cannot be asked.

**The re-creatable asymmetry becomes a property the code carries.** `plot-release-refs.sh` states it in a comment today — a removed checkout *"comes back with `git worktree add`, a deleted ref does not, so the blast radius is bounded by the plan file"* — and that is why the reaper is slug-blind while the ref-deleter is plan-scoped. It now lives in `REMOVAL_IS_RECREATABLE`, checkout true and ref false. A ref deletion refuses in both directions: named against no plan it is the sweep that destroys unlanded work belonging to plans nobody delivered, and named against one it belongs to the plan-scoped ref-deleter that `a-desk-is-finished-with-once` (#705) routes. Nothing here touches that script.

42 tests, one per refusal, each verified to fail against a real violation rather than to pass on the day it was written. Six mutants of the source, each caught: ref made re-creatable (6 failures), `finished -> gone` allowed (7), missing readings accepted (9), the reap refusals ignored (18), `gone` made non-terminal (22), the unbounded-scope refusal dropped (22).
