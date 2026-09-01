---
'@plot-pm/board': patch
---

`readAgentRegistry` reads through a port instead of touching the filesystem itself, and became async with it — the layering rule's direction applied to the registry: `controller → domain → port ← adapter`. Its own tests await it, and `agent-panel.test.ts` follows the calls. A commit restoring the tiny-garden pulse fixture was dropped on rebase: that path is gitignored on main now, so the file it restored is a run cache rather than a fixture.
