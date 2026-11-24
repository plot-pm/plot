# The board refuses unauthenticated remote writes

> The board serves its write routes only on a loopback bind; `PLOT_BOARD_ALLOW_REMOTE_WRITES` no longer opens them, and the refusal names `tailscale serve` with `PLOT_BOARD_ORIGINS`, or an SSH tunnel, as the way to use the buttons from another device.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** plot-describes-itself
- **Issue:** #3311
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Started:** 2026-11-24, Jan Wloka, `bug/the-board-refuses-the-remote-write-opt-in`

## Changelog

- A board bound to a non-loopback address refuses every write route, also with `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` set. The refusal names the two routes that keep the board on loopback: `tailscale serve` with `PLOT_BOARD_ORIGINS`, and an SSH tunnel. Reads on a non-loopback bind are unchanged.

<!-- Board impact: the board server's write gate changes. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

Issue #3311 reports that `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` opens every route in `WRITE_ROUTES` (`packages/board/src/server/index.ts:288`) on any bind, with no authentication. The defect is still on main at `e15c9d319`: `writeGate` returns `allowed` at `packages/board/src/server/write-gate.ts:82` when the opt-in is set, whatever `host` is. `isSameOrigin` (`packages/board/src/server/dispatch.ts:105`) passes a request with no `Origin` header, so `curl` from any machine that reaches the address can claim branches, approve plans and start agents. Only `/api/release-approve` checks a person, through a passkey bound to `http://localhost:<port>` (`packages/board/src/server/passkey.ts:110`).

On a loopback bind the opt-in changes nothing, because `writeGate` allows loopback at `:81` before it reads the opt-in. So "refuse the opt-in on a non-loopback bind", the triage's proposal, removes the opt-in. That is the right change: the opt-in has one effect, and that effect is the defect.

The operator's own setup needs no opt-in. The board stays bound to loopback (the default `HOST`, `index.ts:66`), `tailscale serve` proxies `https://zio.taile33394.ts.net` to it, and `PLOT_BOARD_ORIGINS=https://zio.taile33394.ts.net` admits that origin to the write routes (#3527). The tailnet decides who reaches the board. A second operator who follows Plot's documents to an unattended run must not find a documented switch that publishes agent starts to a network; this plan removes it for the sprint goal: "Plot can take over the software development part of the operator's home automation: a second operator follows Plot's own documents to an unattended run, and that run has a spend cap and a delivery measure."

## Design

### Approach

- **Board server, `write-gate.ts`.** `writeGate(host, env)` allows a loopback host and refuses every other host. `remoteWritesAllowed` and the `ALLOW_REMOTE_*` exports go. Where the old variable is still set, the refusal says that it no longer opens the gate, so an operator who set it reads why it stopped working. The refusal names `tailscale serve` with `PLOT_BOARD_ORIGINS` and `ssh -L <port>:localhost:<port> <machine>`. This is adapter-side code in `packages/board`; no domain rule changes, because the loopback set stays `dispatchAvailability`'s.
- **Reads stay served.** A phone may still read a board bound to `0.0.0.0` (`test/write-gate.test.mjs:200`). Only the write routes change.
- **No new authentication.** A passkey on every route conflicts with the proxy route, because the passkey verifies against `http://localhost:<port>` only. A shared secret is the scheme `dispatch.ts:60` refuses to invent. Both stay out of this plan.
- **Documentation.** `skills/plot-board/README.md` states the two remote routes and what each trusts: the tailnet's access rules for `tailscale serve`, the SSH account for a tunnel. It states that `tailscale funnel` publishes the board to the internet and must not front it. Draft PR #3635 documents the opt-in in the same file and must drop that text.
- `plot-deliverable-search.sh "remote writes"` found no existing helper; the change edits the gate in place.

### Open Questions

- [ ] `[question-refuse-start]` Must the board refuse to start when the old variable is set on a non-loopback bind? Recommendation: no. The board starts, logs one line that names the removed variable, and refuses writes per request, as it does today without the opt-in.
- [ ] `[question-local-callers]` Every process on the machine reaches a loopback board without an `Origin` header. Recommendation: accept, as today; it is the boundary `dispatch.ts` states, and the tailnet adds no new caller to it.
- [ ] `[question-tailnet-identity]` `tailscale serve` adds a `Tailscale-User-Login` header that could name the person on each write. Recommendation: out of scope; a later plan with an auth design may read it.
- [ ] `[question-pr-3635]` Recommendation: amend #3635 before it merges, so no release documents the opt-in; this slice then edits only what #3635 left.

## Slices

### Loopback only

- `bug/the-board-refuses-the-remote-write-opt-in` — `writeGate` refuses every non-loopback host whatever the environment holds, the refusal names `tailscale serve` with `PLOT_BOARD_ORIGINS` and an SSH tunnel, and `skills/plot-board/README.md` documents both routes <!-- builds: the loopback-only write gate in write-gate.ts --> <!-- tests: write-gate.test.ts — 0.0.0.0 with PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand refuses and names the removed variable; write-gate.test.mjs — POST /api/dispatch on HOST=0.0.0.0 with the old variable answers 403 and spawns nothing; a loopback board with PLOT_BOARD_ORIGINS admits the declared origin -->

## Notes

Created on 2026-11-23 from issue #3311, for the sprint plot-describes-itself.
