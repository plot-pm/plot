---
"plot": minor
---

A plan can cite a tracker key (`PROJ-123`) where `## Plot Config` names a
non-GitHub `Tracker:`.

`plot-plan-meta.sh` read only GitHub's `#N` from a plan's `Issue:` line, so a
Jira- or Linear-keyed plan parsed as referencing no issue at all. The board's
inbox is *"open tracker issues no plan references"*, matched through this field,
so a ticket a plan was written and delivered for stayed in the inbox
permanently, filed as undecided.

The parser now reads `PROJ-123` **in addition to** `#228`, but ONLY where the
`Tracker:` key names `jira` or `linear`. This is the script's first
configuration dependency, kept as narrow as it can be: it reads one key, an
unreadable or missing `## Plot Config` means GitHub (today's behaviour, so no
existing repo changes meaning), and a parse never fails for want of
configuration. A `--tracker` flag names the tracker directly for callers that
have already resolved it (and for the contract tests). Accepting any
`LETTERS-digits` token unconditionally was rejected: the key form requires a
digit suffix, so `WONT-FIX` and `TODO-later` never masquerade as references.

<!--
bumps:
  skills:
    plot: minor
-->
