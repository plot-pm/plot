---
'plot': patch
---

<!--
bumps:
  skills:
    plot: patch
-->

A worker whose agent manifest cannot be written is no longer started.

`start_worker` wrote the manifest and launched regardless: both writes were
`|| true`, so a worker the registry could never see started anyway and stayed
invisible for its whole life. An agent outside the registry cannot be seen,
stopped, restarted or reaped through the board, and it holds a claim nobody can
release.

The gate asserts the manifest exists at the RESOLVED path — the post-condition,
not either write's exit status. *Always write a manifest* is a rule the code
already believed it followed, and did; until #488 the file was simply written
somewhere nothing reads. The enforceable condition is that the manifest is where
the reader looks, which only a check at that path can establish, and it holds
however a future edit rearranges the writing.

It sits BEFORE the spawn, ~75 lines ahead of it, so it prevents a launch rather
than killing a process — there is no race, no kill path and no orphan risk. The
worktree and the claim are left untouched, so once the cause is fixed the
operator dispatches again at no cost. A worker that cannot be registered is
worse than one that never started, because the second state is visible.

The refusal names the path it could not write, since the defect it closes was a
directory nobody could see. A successful dispatch reports nothing new: a warning
on every launch would train the reader to skip the rare line that matters.

`/api/continue`'s tolerance of a manifest-less worktree is untouched — that is
about CONTINUING a worker in a worktree older than manifests, while this gate
belongs to creation, where the dispatcher has just minted a session id.
