---
"plot": minor
"@plot-pm/board": patch
---

The fleet pulse says whether a ref holds each branch.

`plot-fleet-scan.sh` publishes `ref_held` per branch — the git fact
`plot-dispatch.sh` tests when it claims. Plot's locking mechanism is a push of
an empty commit that a non-fast-forward refuses, so a branch whose ref already
exists is one no dispatch can take. The fact is derived from the `REMOTE_REFS`
batch the scan already reads to compute `merged` and `wip`: no git spawn, no
host call, which the existing no-network tests pin.

**Why a field and not an inference.** A consumer can almost read this from
`state === 'wip'`, and auto-dispatch does today. The implication is one-way and
lossy at both ends: a MERGED PR overrides `wip` to `merged` while the ref
survives — a squash merge leaves the branch permanently ahead of main, and a
worktree can push it back after the host deletes it — and a `claimed` branch is
a ref carrying only claim commits that no `wip` test sees. Both are refs a
dispatch would be refused against.

**The third claim-shaped field, and a rename of neither.** `claimed` is the
plan file's human-written annotation, which the contract calls *"a reflection
of a claim, not the claim itself — where the two disagree, git wins"*; this is
the git side of that disagreement. `held` is about a worktree on the scanning
machine. `ref_held` is about a ref on the remote, so it is the only one of the
three that reads the same from every machine — and a branch claimed by a
detached worker on another host, which reports `held: false`, is exactly the
population the measured misread came from.

It states the ref and concludes nothing from it. A merged branch whose ref
outlived the merge reports true, because a ref does hold the name; what that
means for dispatch is the consumer's judgement. It is never fed into the wave
arithmetic, which settles waves on `merged` alone.

<!--
bumps:
  skills:
    plot: minor
-->
