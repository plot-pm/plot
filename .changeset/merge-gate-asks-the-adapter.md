---
'plot': patch
---

The merge lookup keeps its own `gh` call, and the exemption in `check-host-cli-callers.sh` now names one blocker rather than two. `pr_open` needs `found`/`none`/`unaskable` about **any** open PR, and `pr-state` answers about one — the newest — collapsing a failed lookup into the same `state:"NONE"` payload as a real absence. Routing that half needs a new op, which is capability rather than routing, and the pair moves together or not at all: `pr_open` vetoes a deletion and is safe only because `pr_merged` refuses on the same silence.

The other blocker was fixed rather than documented. `plot-host.sh pr-merged` reported an absent CLI as `not-merged` where the gate reports `unaskable`, because `is_lookup_miss` matched the shell's own `command not found`. Two tests pin both halves.
