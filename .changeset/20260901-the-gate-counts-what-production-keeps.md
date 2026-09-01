---
'plot': patch
---

CI counts the domain names production still aliases. When a rule moves into the domain, production can keep compiling by re-exporting the old name — and the move then looks finished while the seam is still open. The gate counts those re-exports, ratcheting toward zero, and its failure names each one so a reader sees which seam is open.

An alias is a renaming re-export whose original name is declared in exactly one module: a collision forces a rename, while a name alone in the workspace forces nothing, so renaming it is a name somebody chose to preserve. That excludes the barrel disambiguations in `@plot-pm/domain`, where `approve`, `deliver` and `release` are each declared twice and one spelling must give way. Renaming imports and forwarding wrappers are not counted, for reasons recorded in `scripts/count-domain-aliases.sh`.

The count is 0 at introduction — the `allWavesMerged` alias it was written for was removed while the gate was being built — so the counter was tested against that alias and against a second, invented one before the threshold was set.
