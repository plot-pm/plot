---
'@plot-pm/board': minor
---

The PR refresh asks through the `Host` port instead of calling `plot-host.sh` directly, so a board handed a fixture host asks no CLI and spends no budget. The port gains a `runs` op that names its refusal, and one adapter is bound per refresh rather than defaulted independently by each caller.
