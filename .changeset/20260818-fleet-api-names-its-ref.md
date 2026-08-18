---
"@plot-pm/board": minor
---

plot-board: `/api/fleet` names the ref it read

The read path renders staleness honestly for an eye — "scanned 10s ago" — and
said nothing equivalent to a machine. The gap has a measured cost. During a live
two-agent dispatch on 2026-08-18 an operator read current-looking data while
their local `origin/main` was behind other agents' pushes. Three wrong diagnoses
followed, including "the fleet endpoint is broken" and "the scan exceeds the
board's timeout" — neither true. The board was right every time; it simply could
not say WHICH WORLD it was right about.

The response now carries three fields:

- `readRef` — the commit the scan actually read
- `readRefAge` — how old that read is, in seconds
- `localHead` — the local checkout, which may differ, and when it differs that
  difference is the whole answer

**The fallback runs in one direction, and the asymmetry is the design.**
`plot-fleet-scan.sh` emits only `head` today; a sibling branch adds `read_ref`
and `local_head` while keeping `head` as an alias for one release. Both shapes
are tolerated, because the two branches were deliberately made independent — but
`head` is `git rev-parse --short HEAD`, the local checkout under a name that
implies more. It is a sound fallback for `localHead`, which is the same fact,
and an unsound one for `readRef`, which is a different commit whenever the
operator is not standing on a freshly fetched main.

So a scan that emits only `head` yields `readRef: null`. Filling it in would
manufacture the precise false statement the field exists to end — a report
signed with the name of a commit it never read — silently, on every consumer.
Null says "the scan did not tell me", and a consumer can act on that. The
string `unknown` is passed through distinctly: the scan looked and could not
resolve the ref, which is a different fact from a scan that predates the field.
Neither reads as a confident claim.

`readRefAge` is null rather than 0 before any scan lands, following the absent
value convention `prNextInSeconds` and `mergeable` already set in this file: one
absent-value shape per field, and an absent value never reads as a confident
claim. 0 would assert a read that just happened.

The fallback path is exercised by a test that plants a pulse of each shape
against a scan that cannot succeed, so what comes back is attributable to the
fixture rather than to whatever the script happens to emit today.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. `plot-fleet-scan.sh`
is deliberately untouched — it belongs to the sibling branch
`bug/pulse-names-the-ref-it-read` and two more queued behind it — and no skill
documents the HTTP API, so no skill's behaviour changed.
