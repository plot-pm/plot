---
"plot": patch
---

Migrate plan estate from `## Branches` to `## Waves` format

- Converted 85 plan files to use the new `## Waves` heading format
- Wave headings now carry branch and PR metadata: `### WaveName (Branch: branch/name, PR: #NNN)`
- Description lines are pure prose, no longer mixed with branch metadata
- Plans without wave subheadings receive derived name "Implementation"
- 29 plans remain in old format (multi-branch waves, empty waves, no ## Branches)
- Parser (`plot-plan-meta.sh`) already reads both formats identically
- Migration script added at `scripts/migrate-branches-to-waves.sh` for future use
