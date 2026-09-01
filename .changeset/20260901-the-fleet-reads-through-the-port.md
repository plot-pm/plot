---
'@plot-pm/board': patch
---

The `/api/fleet` read path reads through the domain's ports instead of spawning. A new `Trees` port answers which branch a checkout is on, `planStoreShell` and `treesGit` are its adapters, and the board's route takes readings rather than shelling out — the layering rule's `controller → domain → port ← adapter` direction, applied to the read path the fleet scan drives. The worktree adapters gain specifications rather than only implementations, so what they promise is asserted rather than inferred from their code.
