---
'plot': minor
---

Where `JIRA_EMAIL` and `JIRA_API_TOKEN` are both unset, Plot reads them from the repository root's `.env` and says on stderr that it did. The refusal named the two variables without ever looking where a repository puts them, so an operator holding working credentials — measured 2026-09-17, a 200 from `/rest/api/3/myself` with the same pair the board refused — was sent to create a second token, and "export it in your shell" does not reach a long-lived board process anyway. The environment always wins and the file is not opened where it answers; naming the source is a requirement rather than a nicety, because two tokens may exist and an operator debugging a 401 must be able to tell which one was used. Half a credential in the file is refused rather than partially adopted, since adopting an email alone would turn today's honest refusal into a 401 further in. The parse is a per-variable `sed` that evaluates nothing: `set -a; . ./.env` aborts in zsh on an unquoted JSON line and imports every unrelated name in the file, while `grep '^NAME=' | cut -d= -f2-` returns empty for an `export`-prefixed line and keeps the quotes on a quoted one — and a quoted token reaching `curl -u` is the 401 this removes. The Jira budget ledger now records a per-account hash instead of the email: that ledger held 2448 lines on one machine, it was written only under a deliberate export until this change and is written wherever a `.env` exists after it, so the widening owns the writing down — and the redaction stays one-to-one because the field is a match key that `plot-budget.sh` and `spend-rate` read, where a constant would merge three accounts' rate windows into one. `.env` joins `.gitignore`, and `/plot-board-setup` names the file when it records `Tracker: jira`.

<!--
plan: docs/plans/2026-09-17-a-credential-is-read-where-a-repo-keeps-it.md
bumps:
  skills:
    plot: minor
    plot-board-setup: patch
-->
