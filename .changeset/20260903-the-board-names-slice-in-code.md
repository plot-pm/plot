---
'@plot-pm/board': minor
---

The board names a Slice in code. `WaveSchema` becomes `SliceSchema`, `type Wave` becomes `type Slice`, and 73 identifiers follow — measured 58 board `Wave` instances on this estate, every one holding exactly one branch, which is `DESIGN-slice.md`'s Slice rather than the fleet cohort.

The three wire schemas emit `slices` and accept `waves` through a `z.preprocess` reader, so an old client meeting a new server still parses instead of silently reading no slices. `plot-plan-meta.sh` ships separately and emits `waves` indefinitely, which makes that reader the steady state rather than a deploy-window courtesy.

The domain's `Wave` — the cohort spanning plans — is untouched. `AgentRow.wave` keeps its name: it feeds `data-wave-row`, and a selector moves with its tests in one commit.
