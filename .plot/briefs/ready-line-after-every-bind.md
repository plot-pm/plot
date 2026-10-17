## Implementation brief — the-ready-line-waits-for-every (slice: Ready line)

- **Plan (canonical):** docs/plans/2026-10-17-the-ready-line-waits-for-every.md on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1953 merged
- **Branch:** `bug/ready-line-after-every-bind` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This is one of two independent slices in the plan (the other is
`bug/released-desk-keeps-its-note`). They touch disjoint files — this one stays inside
`packages/board/src/server/index.ts` and its test — and neither waits on the other.

### What to build

`packages/board/src/server/index.ts:1084-1092` prints `Plot board: http://localhost:<port>`
inside the first `listen` callback (`::1`, or `HOST` if set), then starts `bindNext` to bind
the rest of `BIND_ADDRESSES` (`:1092`). A client that reads that line and connects over IPv4
in the gap before the second bind completes gets `ECONNREFUSED 127.0.0.1`. Measured 2026-10-16
in a Linux container (Ubuntu 24.04, node 24, `--cpus=4`): some runs of the board tests failed
with that exact error, at the same rate with or without the #1899 fix. `port.test.mjs:247-259`
("the board answers on both loopback families"), which requests `127.0.0.1` right after the
ready line, is the likely flaky test — not GitHub CI, where the race has not shown.

The fix moves the print to the point where the bind chain has nothing left to try: `bindNext`
already has that terminal case (`if (address === undefined) return;` at `:1066`), so the print
belongs there, after the last bind settles (succeeds or warns). The line text is unchanged —
nothing that reads it needs to change. The `tailscale:` line (`:1093-1099`) still runs after
the ready line; its comment currently claims "prints first either way" and needs to state the
guarantee the new code actually gives.

The canonical text is the plan's Design section ("Approach — Ready line"); this brief is
orientation, not a replacement for reading it.

### Decisions the plan settles — do not re-derive them

- **Extract the bind chain so a test can hold it open.** The plan's own done-when requires a
  unit test that drives the chain with an *injected* listen, releasing each bind's callback by
  hand, and asserts the ready line prints only after the last one settles — then goes red when
  the print is moved back to the first callback. That seam does not exist today: `bindNext`
  closes over the real `http.createServer(serve).listen(...)`. Pull the chain into a function
  that takes the listen call as a parameter, so the test can substitute a fake one. The panel
  recorded a disagreement here (deliverable and contradiction wanted the injected-listen seam;
  cost wanted to occupy `127.0.0.1:<P>` and assert the "could not also bind" warning precedes
  the ready line) and resolved it in the plan: **the injected-listen seam is the done-when; the
  occupied-port test is an acceptable addition, not a substitute.**
- **The print moves to the terminal case of the chain, not to a `Promise.all` or a count of
  pending binds.** `bindNext(rest)` already recurses until `rest` is empty; that recursion IS
  the signal that every address has been tried. Rebuilding the same fact with a counter or a
  promise collection duplicates logic the function already expresses.
- **A failed extra bind still degrades, it does not die — and does not block the ready line
  past that point.** The existing comment at `index.ts:1054-1059` ("A FAILURE HERE DEGRADES, IT
  DOES NOT DIE") is the standing rule for every bind after the first: the warn-and-continue path
  in `extra.on('error', ...)` already calls `bindNext(remaining)` to keep the chain moving. The
  fix only changes *when* the chain's end result gets printed, not what a failure does in the
  middle of it.
- **No new board-server test.** The plan's done-when is explicit: the unit test drives the
  extracted bind chain in isolation (fake listen, no real sockets, no real server), and
  `port.test.mjs` is reused rather than duplicated — it already asserts the right contract
  ("every family the board bound answers, and at least one did"), so the move must not change
  what that test proves, only make it stop racing.
- **Keep `boundPort`, never `REQUESTED_PORT`, in the extracted code.** The existing comment at
  `:1048-1051` is the reason: under `PORT=0`, the OS assigns a port during the FIRST `listen`
  only, and every subsequent bind in the chain (and the ready-line print itself) must read that
  assigned value off `server.address()`/`boundPort`, never re-ask for port `0`.

### Done when

The plan's slice line is the specification. Lift these assertions, each of which a naive fix
would pass without:

- **A unit test drives the extracted bind chain with an injected listen**, releases each bind's
  callback by hand, and asserts the ready line prints only after the LAST one settles. It must
  go red when the print is moved back to the first callback — write that regression check by
  temporarily reverting the move and confirming the test fails, per the plan's Notes ("no juror
  ran the code... the implementing slice reverts the print move once and shows the new test
  fail before it is trusted").
- **`port.test.mjs` keeps its existing contract** — every loopback family the board actually
  bound (not warned-about) answers a request issued right after the ready line prints. Do not
  weaken or duplicate this test; reusing the describe's existing server is the plan's explicit
  instruction.
- **Under `HOST`, the `tailscale:` line still follows the ready line.** `BIND_ADDRESSES` becomes
  a single-element array when `HOST` is set, so the chain still has exactly one terminal case to
  print from; confirm this path still orders the two log lines correctly.

Plus: a changeset in `.changeset/` for `@plot-pm/board` with the description first and the
`bumps:` block last (see `CLAUDE.md` § Versioning — the order is not cosmetic, a `bumps:` block
written first silently becomes the published description). Arrow functions for any new function
in `packages/domain` — not applicable here since this slice stays inside
`packages/board/src/server/`, where the board's existing `function`-declaration style is not
being converted wholesale (`CLAUDE.md` § The Domain Package: convert only what you write, not
60 untouched neighbours). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints —
it resolves the tests related to your changed files, `pnpm --filter @plot-pm/board exec vitest
related --run`, and `pnpm run typecheck`. The suites in the `CI suites` config key
(`pnpm run test:board`, among others) run in CI on every PR; a failure there comes back as a
correction, so do not run the full e2e suite locally (`CLAUDE.md` § Testing — it dispatches real
workers into sandbox repos and is CI's job, not a local one).

No `.sh` file is in scope for this slice, so `scripts/check-shell-lines.sh`'s ratchet should not
move. If anything here unexpectedly touches a `.sh` file, that growth must be paid for by
removing an equal number of shell lines elsewhere in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is still
moving) — never `gh pr create`; it derives the title from the plan's wave heading and refuses a
branch with no commit beyond a `PLOT-BLOCKED` marker. When the PR exists, append `→ #<number>`
to this branch's line (`### Ready line`) in the plan's `## Slices` section. Push the first real
commit as soon as it exists — do not wait for the full slice to be done before the branch's
work becomes visible.

### Scope guard

This branch owns `packages/board/src/server/index.ts` (the bind-chain extraction and the moved
print) and its test file, `packages/board/test/port.test.mjs`. It does not touch
`packages/domain/src/rules/ended-desk.ts`, `packages/board/src/server/fleet.ts`, or
`packages/board/src/server/ended-desks.ts` — those belong to the plan's other slice,
`bug/released-desk-keeps-its-note`, dispatched (or dispatchable) independently and verified at
plan-authoring time to touch disjoint files from this one. If dispatched concurrently, a
collision between the two branches is not expected; if one surfaces anyway, report it rather
than reaching into the other branch's files.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
