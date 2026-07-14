---
"plot": patch
---

`plot-config.sh` now falls back to `AGENTS.md` when the repo-root `CLAUDE.md` has no `## Plot Config` section. `CLAUDE.md` is still checked first for backwards compatibility; `AGENTS.md` is the fallback for repos that have migrated to a hub-and-spoke agent-rules layout. (#45, thanks @damoeb)
