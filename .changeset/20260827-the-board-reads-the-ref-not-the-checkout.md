---
'@plot-pm/board': patch
---

The board reads plans and sprints from `origin/<default>` rather than from its
own checkout, so a plan approved or delivered elsewhere is visible without
anyone pulling the board's worktree — and a plan that exists only locally is
shown, marked `not pushed`, rather than silently missing.

`board.ts` read plan files with `fs.readFileSync` while the fleet scan beside it
read `origin/<main>` and fetched every pulse. One row therefore rendered wave
facts from a fetched ref and plan facts from a working tree nobody pulls, and
the two disagreed continuously: the board's checkout was 8 commits behind on
2026-08-27, then 16 about an hour later.

Two operator reports twenty minutes apart came from that one cause — a
`2 rounds` badge beside phase Development (the badge renders only for a Draft
card, and the board had been handed `phase: 'Discovery'` for a plan the ref said
was `Approved`), and a Deliver button refusing a plan whose every wave had
merged. Neither renderer was wrong; both behaved correctly on a plan parsed from
an old file.

The estate now arrives in ONE `git cat-file --batch` — 151 blobs in 0.013 s
against ~0.8 s for a per-file loop, on a path the client polls every few
seconds — and the merge runs in one direction only: the ref's plan always wins,
the working tree may add a plan the ref lacks but never override one it has.
Where the ref cannot be resolved the board says so instead of quietly promoting
the checkout. The board also now names the ref it read and how old that read is,
which is what makes the next such report a diagnosis rather than a mystery.
