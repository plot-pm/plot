---
'plot': patch
'@plot-pm/board': patch
---

A rejected claim push no longer refuses the next assignment on the JS worker loop: the reset refusal counts commits ahead of the branch's upstream, so the unpushed empty claim commit is not read as held work.
