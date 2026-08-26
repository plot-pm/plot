---
"plot": minor
"@plot-pm/board": patch
---

`plot-host.sh`'s `issue-list` and `issue-view` answer for Bitbucket instead of exiting 4.

Both issue ops refused on Bitbucket with a message that had gone stale — `bb`
gained `issue list` and `issue view` after the refusal was written, so a
Bitbucket team with its tracker enabled saw an empty inbox that read as *you
have no tickets*. The adapter now parses `bb`'s text (it has no `--json` for
issues) and pins the `bb` version the parse targets (`0.6.0`), so an upstream
format change fails loudly rather than mis-reading a column.

Three measured `bb` traps are handled: `bb` writes errors to STDOUT ANSI-coded,
so the stripper runs before the error match and an error is never parsed as an
issue; `bb issue list` has no `--limit`, so the caller's bound is honoured after
parsing; and the list carries no per-issue URL, so `url` is "" (issue-view
constructs one from the footer). Exit 4 narrows to the tracker-DISABLED case
(`bb` answers 404/410); any error whose wording is unrecognised defaults to exit
3, because guessing 4 would turn a broken call into a confident "no tickets".

The board's Bitbucket request budget counts the now-real call: a refresh costs
`pr-list`'s three plus one `issue-list`, so `PR_REQUESTS_PER_REFRESH.bitbucket`
rises 3→4 (the cadence stretches to 240 s, keeping the hourly spend at 60 —
against a limit a board once hit account-wide).

<!--
bumps:
  skills:
    plot: minor
-->
