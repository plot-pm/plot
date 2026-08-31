---
'@plot-pm/board': minor
---

The registry reads the process group a dispatch recorded.

`AgentEntry` gains an optional `group` — the wrapper and both monitors — read
from the manifest fields the dispatcher now writes at spawn.

**Optional with no default, unlike every sibling field, and that is the
contract.** A default would turn *this manifest cannot say what it started* into
*it started nothing*, and those are different facts. The whole object absent means
unknown; a member of `''` means that process was genuinely never started. Members
go through the same validation as `pid`, so `0` and junk read as absent — a group
member that cannot be a pid must not send a reader to check the wrong process.

Like `pid`, it is a **display fact a reader can go check, not an input** to
liveness: a manifest can go stale, and only the process table answers whether one
of these still runs.

`stampManifest` writes the group on both paths — first dispatch and relaunch —
and drops any stale copy unconditionally, so a re-stamp cannot leave a previous
run's processes on the row. The parity test that pins it byte-identical to the
dispatcher's inline `awk` gains three cases: an existing group replaced on each
shape, and a dispatch with no monitors attached.

`/api/continue` records the group **empty on purpose**. It spawns the agent
directly — no wrapper, no monitors — so `''` is the true answer, and passing it
explicitly is what stops the previous dispatch's processes surviving on the row.

Two tests asserting *a first stamp is byte-identical to today* and *the six
launch-time keys* were rewritten rather than worked around: they pinned the
contract this change deliberately moves. The half still true — a first dispatch
carries no relaunch bookkeeping — is kept.

The board renders unchanged.
