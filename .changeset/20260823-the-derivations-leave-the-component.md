---
'@plot-pm/board': patch
---

board: the row derivations leave AgentList.tsx into eight subject modules

AgentList.tsx was 8104 lines and every one of its last 60 commits touched the
file, so two branches on unrelated subjects still collided there. The 65 pure
row derivations (no JSX, no hooks) move out into eight modules under
`app/lib/agent-rows/`, grouped by subject: host-notes, collapse, waves,
sections, activity, stuck, row-identity and actions. A branch changing wave
grouping and one changing host notes now share no file.

Pure move — no function rewritten, renamed, merged, split or re-signatured;
every docstring travels verbatim, including the measured ones (groupedNote's
default over five live blocked waves, isFinished's "a local fact may describe a
row and never order the fleet"). No re-exports: all 14 importing files point at
the owning module, so AgentList.tsx no longer names a symbol it no longer holds.
The useChangeMarks and useActivity hooks stay behind with the components that
call them. AgentList.tsx: 8104 → 5284 lines. No behaviour change — the board
suite is green with no test's expectations edited, only its imports.
