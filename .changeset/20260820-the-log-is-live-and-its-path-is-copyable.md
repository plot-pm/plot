---
"@plot-pm/board": patch
---

board: the worker-log footer path is copyable, and it is still not a link

The path along the panel's foot names the one thing here that lives OUTSIDE the
browser, and it was plain text with no way to take it anywhere. A `file://` link
cannot fill that gap — a browser refuses to navigate from `http://localhost` to
`file://`, which is why it was printed as text in the first place — so the
footer gets **Copy path** beside the value, and the value stays text. The rule
is the board's own: an affordance that cannot navigate must not look like one.

Copy yields the exact string the footer shows, byte for byte, for pasting into a
terminal where a pager reads a 60 MB log far better than a browser can. It tries
the async Clipboard API and falls back to `execCommand` where that is absent;
the board runs on `http://localhost`, a secure context that has the API, but the
fallback keeps the control honest anywhere and costs little.

The live rendering above it is what makes the path rarely needed, and it is
already built: the panel polls on `LOG_POLL_MS`, so a line the worker appends
appears in the open panel within one interval without reopening it. The real
output that fills it is supplied by `the-panel-names-the-working-process` (the
Reads branch of this plan); this branch adds the footer's Copy and pins the
liveness and the not-a-link property as tests, so a well-meant edit cannot turn
the path back into a bare string or an anchor.

<!--
bumps:
  skills:
-->

No skill version bumps: this is board-side only. The polling, the log endpoint
and `plot-worker-state.sh` are untouched — this wave is the footer control plus
the guards around behaviour the sibling branches already supply.
