---
'plot': patch
---

`plot-release-refs.sh` reads a branch that origin does not hold as `absent` and asks the host nothing about it. A merge or open-PR lookup that the host cannot answer keeps the ref with the reason "the host could not be asked", and no longer reads as unlanded work or as no open PR. The script asks `firstRefRefusal`, which gains the refusals `merge-unaskable` and `open-unaskable` (#3556).
