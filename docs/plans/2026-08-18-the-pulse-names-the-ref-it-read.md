# The pulse names the ref it read

> `plot-fleet-scan.sh` labels its report with local `HEAD` while reading `origin/main`, so a report about one commit is signed with the name of another.

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Delivered:** 2026-08-18, jwloka, PR #213
- **Released:** 2026-08-18, v2.5.1
- **Started:** 2026-08-18, Jan Wloka, `bug/pulse-names-the-ref-it-read`

## Changelog

- `plot-fleet-scan.sh` reports the commit it actually read (`origin/<main>`), not the local `HEAD` it happens to be standing on, and says how far behind the local checkout is when the two differ.
- `/api/fleet` carries the same fact, so a consumer can tell *the board is current* from *the board is current about an old world*.

## Motivation

The scan reads plans from `origin/$MAIN`. Its banner is built from a
different ref:

```
943:  HEAD_SHORT=$(git rev-parse --short HEAD 2>/dev/null)
970:  banner="plot-fleet pulse — $HEAD_SHORT on origin/$MAIN"
```

`HEAD` is the local checkout. `origin/$MAIN` is what was read. On `main`,
immediately after a fetch, the two agree — which is why this has survived: the
common case makes it look correct.

Measured 2026-08-18 in this repo, standing on a feature branch:

```
scan header: plot-fleet pulse — 91a9a60 on origin/main
local HEAD:  91a9a60
origin/main: ee199aa
```

The header names `91a9a60` and attributes it to `origin/main`, which is
`ee199aa`. The sentence is false in the only part a reader uses it for.

**What it cost.** During a live two-agent dispatch on 2026-08-18, an operator
read the scan repeatedly while their local `origin/main` ref was behind — other
agents were pushing. Every scan described an older world, and the banner
confirmed a ref that looked plausible. Three wrong diagnoses followed, including
"the board's fleet endpoint is broken" and "the scan exceeds the board's
timeout", neither of which was true. The board was right each time.

This is the failure mode Plot has already paid for twice and written up in
`plot-host.sh`: **a report that is wrong in the reassuring direction**. A banner
that said "cannot determine" would have been investigated in seconds. A banner
naming a real-looking SHA was believed.

The same value travels in the `--json` payload (line 1227) as `head`, so every
downstream consumer — the board's Agents tab included — inherits the
mislabelling.

## Design

### Approach

Report the ref that was actually read, and make a divergence visible rather
than silent:

```bash
READ_REF=$(git rev-parse --short "origin/$MAIN" 2>/dev/null)
LOCAL_HEAD=$(git rev-parse --short HEAD 2>/dev/null)
banner="plot-fleet pulse — $READ_REF on origin/$MAIN"
# When the local checkout is behind what was read, say so: the operator's
# working tree and this report disagree, and that is worth one clause.
```

When `origin/$MAIN` cannot be resolved (no remote, fresh clone), the honest
answer is that the ref is unknown — not a silent fall back to `HEAD`, which
would reintroduce exactly this bug in the case where it is hardest to notice.

The `--json` payload gains the same distinction: `read_ref` for what was read,
and `local_head` beside it. `head` is kept as an alias for one release so the
board is not broken by the rename, then removed.

**Not in scope:** fetching. The scan is read-only and stateless by design
(Manifesto Principle 1), and a scan that mutated the local ref store would be a
write nobody asked for. Reporting staleness is the fix; curing it is the
operator's call.

### Open Points

- [ ] Should the scan warn when `origin/$MAIN` is itself old (no fetch in N
      minutes)? It cannot know without a network call, but `git log -1
      --format=%cr origin/$MAIN` is free and would name the age of what it read.

## Slices

### Implementation (Branch: bug/pulse-names-the-ref-it-read, PR: #213)
- the header, the `--json` fields, and a contract test that stands on a diverging branch and asserts the banner names `origin/main` rather than `HEAD`.

## Notes

The test is the load-bearing part: it must construct the divergence (commit to
`origin/main` without fast-forwarding the local checkout) rather than asserting
against a repo where the two refs happen to agree. A test written in the common
case passes against the buggy code.
