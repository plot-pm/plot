---
---

plot-host: a transport failure exits non-zero instead of answering NONE

`gh` exits 1 both when a branch has no PR and when the host cannot be
reached, and the adapter caught both with one `|| echo '{"state":"NONE"}'`
— so a caller could not tell *this branch has no PR* from *I could not
ask*. On 2026-08-17 GitHub returned 503 for an afternoon and every branch
read as having no PR: wrong in the reassuring direction.

The exit code cannot separate them (measured: both are 1), so the CLI's
own stderr decides. A recognised miss phrasing — or no message at all,
which is what a miss looks like through a CLI that does not explain
itself — answers `NONE` and keeps exit 0. Everything else prints the
host's words on stderr and exits 3, with nothing on stdout.

An allowlist of miss phrasings rather than a blocklist of failures: a
blocklist goes stale into silence the first time the CLI rewords itself,
and silence here is indistinguishable from a branch that has no PR.

<!--
bumps:
  skills:
    plot: patch
-->
