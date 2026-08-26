---
"plot": minor
"@plot-pm/board": patch
---

`plot-host.sh`'s `issue-list` and `issue-view` answer through Jira when the repo
declares `Tracker: jira`, so a team whose tickets live in Jira sees them in the
board's inbox instead of an empty section that reads as *you have no tickets*.

`Tracker` was a documented `## Plot Config` key with no reader — a team could
declare `Tracker: jira`, watch it be accepted, and get an empty inbox forever.
This adds the first reader. The two issue ops dispatch on `Tracker`, NOT on
`backend()`, and independent of `Git host`: a Bitbucket repo tracking in Jira is
the normal enterprise case and must work. Absent (or `plot`/`github-issues`/an
unrecognised scheme) is today's behaviour exactly — the arm is opt-in, so no
existing repo changes meaning.

Jira is reached through its REST API with a token from the environment — no CLI
dependency, deliberately: `gh` and `bb` are already two binaries an adopter
installs, and Jira is the tracker most likely to sit behind corporate SSO, so a
third binary would make it the hardest path to adopt. The base URL travels on
the `Tracker` value (`jira https://acme.atlassian.net`), the same shape
`plot-plan-meta.sh` reads the scheme off and the Jenkins arm reads its job path
off — no new config key. Auth is Basic (`JIRA_EMAIL` + `JIRA_API_TOKEN`). The v2
endpoints are used, not v3: v2 returns `summary` and `description` as plain
strings, where v3 returns `description` as an ADF document tree — and the body
is a problem statement for `/plot-idea`, so a string is the honest shape.

The three outcomes stay apart, and the story's name is the reason. An empty
result set is a real answer (exit 0, empty stdout); an auth failure, a network
failure or any HTTP error is the question FAILING (exit 3, empty stdout, Jira's
own message on stderr). There is NO exit-4 case for Jira — a configured Jira
CAN be asked, so an outage is a failure to answer, never the bitbucket-DISABLED
"this host has no tracker". An auth gap must never wear the empty-inbox mask.

READ-ONLY in both directions: only GET is ever issued, asserted in the tests
(no `-X`, no `-d`). A plan referencing an issue is Plot's record, not the
tracker's. The board is unchanged — the emitted contract and the exit-code
semantics (0→answered, 3→failed, 4→unsupported) are exactly what it already
consumes, so a Jira failure surfaces as `failed`, never `unsupported`.
