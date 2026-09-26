---
'@plot-pm/board': patch
---

The Agents tab carries a checkbox that hides the rows belonging to somebody else. It is off on a first visit, remembers the reader's choice in `localStorage` beside the section folds, and never travels in a URL — a link carrying the filter would hide rows belonging to whoever opened it. The decision is the domain's `isMine`, which answers false only for a row somebody else owns, so a row with no pull request, a pull request whose author the host never named, and a board whose own identity is unconfigured all keep every row: an unknown owner is shown. Unticking restores the full set. The control states how many rows it hid, and says so when the board names no reader, because a checkbox that ticks and changes nothing reads as a broken filter.

<!--
plan: docs/plans/2026-09-24-the-board-shows-me-only-my-work.md
-->
