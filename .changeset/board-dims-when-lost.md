---
"@plot-pm/board": minor
---

**A frozen board now stops inviting, not just lying.** `board-shows-staleness` made the page admit its numbers were old — a banner, `(frozen)` in the footer, stopped clocks. It did not finish the job: rows kept full contrast, links kept their affordance, and the row action menu kept offering `Start work` on data minutes old. A reader who scrolled past a single banner was looking at a control surface behaving exactly as it does when everything is fine.

The distinction is between **information** and **posture**. The banner says *these numbers are old*. What was missing is *do not operate this right now*.

**Two escalating states.** The banner still comes first and alone. After a sustained silence the page dims, blocks interaction with the board, and names the way out.

**Counted in missed polls, not seconds.** The two tabs poll 7.5× apart — `POLL_MS` 30 s against `FLEET_POLL_MS` 4 s — so one seconds-threshold means *seven and a half missed polls* on one tab and *a single one* on the other: it would dim on the first hiccup in one place and only after a real outage in the other. Counting consecutive failures keeps the statement identical on both, and survives someone changing an interval later.

**The threshold is eight, and it was measured rather than guessed.** `pnpm board` runs under `node --watch`, so an ordinary edit restarts the server and the tab loses contact several times an hour. Five real restarts were timed on the implementing machine by touching the watched artifact and polling every 50 ms: the server was unanswerable for 3.1 s, 4.5 s, 5.1 s, 5.8 s and 9.1 s (median 5.1 s), and a cold boot took 21.2 s. At the fleet's 4 s poll those cost at most 3 and 6 consecutive failures. Eight clears the worst of them, so the case that happens several times an hour never triggers the case that means something.

**Both tabs, which meant unifying two error models** — the largest part of this, and a behaviour change rather than an addition. Silence was measured for the Agents tab only, and the two tabs answered the same outage in opposite ways: Agents kept its rows, while the Board tab set an `error` string and **replaced its cards** with a red message, discarding a payload it still held. The Board tab now gets the newer *degrade, do not hide* treatment. One outage no longer produces two different stories depending on which tab is in front.

Five further decisions, each reached by discarding the obvious answer:

- **A server that answers badly does not dim.** HTTP 500, malformed JSON, `{ error: … }` — it is alive and speaking, so *no contact* would be plainly wrong and a restart hint would be the wrong advice. The existing error path keeps that case, and a bad answer resets the silence count rather than accumulating toward an overlay telling the reader to restart something already running.
- **Blocked means interaction with the BOARD.** Reading needs no clicks, so reading never stops: scrolling, selecting and copying a branch name keep working, and the rows stay legible underneath. The overlay's own message and command stay usable, because blocking the way out would be a dead end with a lock on it. An already-open plan modal stays usable — it is a layer above the board and has its own error path; opening a *new* one is board interaction and stops.
- **Blocked actions stay visible and `aria-disabled` with the reason**, never removed. Vanishing buttons make the layout jump twice, on loss and again on recovery. `StartWorkButton` moved off the native `disabled` attribute for this: a natively disabled button leaves the tab order, taking the control *and* its explanation out of reach of exactly the reader who cannot see that the page has dimmed.
- **The command and port come from the server**, travelling with the last successful poll via a new `server` field on the board document, read from the project's own `## Plot Config` under a new `Board command` key. `pnpm board` is *this* repo's convention and Plot hardcodes no project conventions (Principle 5) — an adopting project would otherwise be handed advice that does not work. A project declaring none gets no command rather than a guessed one. The overlay names the port *this page was served from* and never probes others: a page that guessed could attach itself to a different project's board.
- **Returning to a backgrounded tab re-checks rather than counts.** Browsers throttle hidden timers, so a minimised window would otherwise come back holding a count assembled from however often it was allowed to wake. Visibility returning issues a poll: it either succeeds and the overlay goes, or it fails and the overlay is honest.

Pinned by 25 browser tests against the shipped artifact, each written against an assertion a weaker implementation passes without — one failed poll dimming nothing, both tabs dimming after the same *number* of failures, the Board tab reaching the state at all, the 500 and malformed-JSON cases staying clear, the overlay's own command being clickable and selectable while the board's controls are not, and the command and port round-tripping from a payload that names neither of this repo's defaults.

**Not covered, deliberately:** the IPv4/IPv6 case, where the server listens on `[::1]` and the browser resolves `127.0.0.1`. No overlay helps there — the document never loads — and it is recorded as a separate finding.

<!--
bumps:
  skills: {}
-->
