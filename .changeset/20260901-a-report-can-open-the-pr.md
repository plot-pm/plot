---
'@plot-pm/board': minor
---

The master agent opens a PR on `owes a review`, and on nothing else.

It subscribes to the channel with a purpose and asks the controller to act; the
monitors still report and write nothing. Opening a PR is the one act safe to
take without judgement, and the reason is reversibility — close it, and the
branch, the worktree and the work are untouched. Restarting an agent, reaping a
worktree and killing a worker stay with `plot-reap.sh` and `plot-dispatch.sh`.

It acts on the STATE and not on the message: the host is asked whether a PR
exists before the domain is asked whether to open one, so a finding republished
on every interval produces one PR and then a printable refusal. A branch that
also owes a gate still gets its PR, with the missing gate named in the body —
withholding it would leave finished work invisible until somebody happens to
write the changeset. It does not write that changeset: a changeset is a
judgement about what changed, and an agent guessing produces the `<!--` class of
entry this repo is already fixing.
