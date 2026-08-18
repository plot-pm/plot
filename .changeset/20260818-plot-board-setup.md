---
"plot": minor
---

plot-board-setup: a board adoption spoke

The board runs in any repository already — it reads the CWD, not its own
location. What was missing was everything around that: no adoption path
(plot-init never mentioned it), no start route for other projects, and no way
to tell a working board from a broken one.

The verify gate asserts the cards, not the port. A plan written with a bare
`**Phase:** Draft` line instead of the list item parses as `format: none`, and
the board then boots, serves valid JSON, and renders nothing — indistinguishable
at the browser from a broken board, and passed cleanly by an HTTP 200 check.
When the board comes back empty, plot-plan-meta.sh names the offending files.

CLI auth is reported as ok/failed/unknown rather than a boolean. `jen -I <slug>
auth status` exits 0 and prints "Keycloak: signed in" for a slug that does not
exist, because the slug expands into a URL pattern without being reached; only
the `Jenkins auth:` line answers, and an unrecognised output reads as *cannot
verify* rather than authenticated.

The board is started by a script rather than by skill prose, because the
teardown must be guaranteed rather than remembered: `trap cleanup EXIT` reaps
the server on the failure paths where an instruction would be forgotten.

`--start` is the daily action beside the once-per-repo ceremony, and it needs
evidence more than setup does. The board answers a busy port by printing
"already running" and exiting 0 — deliberately, since several worktrees run
boards side by side and one shooting down another is the worse failure. But
that means the exit code answers a different question from the one `--start`
asks, and it was measured answering it wrongly: 7777 was held by a different
Plot installation while the operator's board was not running. So `--start`
fetches `/api/board` from the board that stays up and reconciles its cards
against the probe's plan count, rather than trusting an exit code.

Artifact selection prefers the live `marketplaces/` copy and falls back to
newest mtime. A machine carries several artifacts — one measured setup had
three, including a build two weeks stale — and lexical path order picks among
them by accident.

Jenkins is recorded and verified, not rendered — the `CI` and `Jenkins instance`
keys are read back by the skill to check auth against the right instance, and
the skill says plainly that the board does not yet display Jenkins status.

<!--
bumps:
  skills:
    plot-board-setup: minor
    plot-init: patch
    plot: patch
-->
