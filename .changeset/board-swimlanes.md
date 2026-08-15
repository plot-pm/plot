---
"plot": minor
---

Stories become swimlanes — one row per story, plans in the column their phase puts them in.

Off by default and offered only where it can show something: with no stories, lanes would render a single "(no story)" row, which is the board with a wasted column. It is a **layout of the same board**, not a third tab — the question is still "where does this work stand", grouped by story as well as phase.

The Discovery column doubles as the row header, carrying the story's title, slug, status and plan count. A story with no plans keeps its row: "shaped, nothing planned yet" *is* the Discovery phase, and hiding the row would hide the one thing the header exists to show.

Two cases the lane builder refuses to lose. A plan naming a story with **no file** — a typo, or a story not yet written — gets its own row labelled as such, because dropping it would make work vanish from the board. And a test pins the invariant that lanes **partition** the cards: counted twice would double-report work, dropped would hide it.

Found by looking at the result: a row is as tall as its fullest cell, and the rest stay empty. Harmless in columns, multiplied across rows — one lane with four Endgame cards pushed the next story below the fold. Cells now cap and scroll internally, so every lane stays reachable without collapsing what it holds.
