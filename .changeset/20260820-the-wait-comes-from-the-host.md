---
"plot": minor
---

plot-fleet: a bare rate-limit message waits for the host's real reset, not a constant

`rateLimitBackoffMs` reads three shapes and is correct for all three: a named
wait (*"try again in 45 seconds"*), an absolute reset stamp, and the bare
exhaustion message. The first two carry their own answer; the third did not, and
fell back to `PR_BACKOFF_MAX_MS` — a 120 s guess that could retry four times into
a closed door when the budget had eight minutes left to run.

The bare message names no reset, but the host still knows one. `gh api
rate_limit` states it per resource and is itself **free** — the rate-limit
endpoint is not rate-limited. Measured 2026-08-20 while GraphQL read `0/5000`,
it reported the reset ~8 minutes out. So on the bare branch the throttle now asks
once, waits for the stated reset, and keeps the constant only as the last resort
behind an unreadable answer.

**The read is confined to the one branch that needs it.** A message naming
seconds already holds the answer and asks nothing; a reset stamp already holds
it and asks nothing; a non-rate-limit failure returns null and must not spend a
call — free-but-still-real — on its way there. GraphQL because that is the budget
`gh pr list` spends: the endpoint reports every resource's reset, and waiting on
the wrong one would wait for a budget that was never exhausted.

**Once per backoff, never per call**, structurally: `rateLimitBackoffMs` is
called once per failed refresh, and the fetcher is consulted at most once inside
it. The decision stays a pure function — the fetcher is injected, so the branch
logic (missing GraphQL resource, expired reset, malformed JSON → the ceiling) is
covered without the network. The one line the tests cannot reach is the `run('gh
api rate_limit')` that feeds the pure parser, and it returns null on any throw so
a failure inside a catch block does not propagate a second error out of it.

**Bitbucket is untouched.** `bb` has no free reset endpoint; the fetcher is
passed only when the backend is `github`, so a Bitbucket board's bare message
keeps the ceiling exactly as before. And the ceiling still answers when no
fetcher is supplied — the pure path the issue poll and the scan's host questions
keep until the sibling change routes them through this same throttle.

Scope: the *value* of the wait on the bare branch. Routing more callers through
the throttle is `feature/every-host-consumer-slows-down`; the banner and the note
that say a spent budget from an unreachable host are the two `Says` branches.

<!--
bumps:
  skills:
    plot: minor
-->
