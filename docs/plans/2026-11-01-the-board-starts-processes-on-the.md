# The board starts processes on the /api/board request path

> `GET /api/board` starts dozens of short processes one after another before it answers. On a loaded machine the request outlasts the page's wait, and the page shows "No contact with the board server" while the server is alive.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #3017
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/api/board` answers from values the board already holds. A warm board starts close to zero processes per request, so the page no longer reports "No contact" on a loaded machine.

Board impact: yes, and it is the whole subject. No plan-format change, no schema change, no wire field.

## Motivation

Measured 2026-11-01 on the operator's machine, board pid 28045 on `origin/main` at `eeea594c6` (issue #3017):

- `/api/board` took 7.8 s, 17 s, 22 s, 26 s, and earlier 30 s, 48 s and 61 s. The page showed "No contact" for 17 and later 103 polls.
- The board process used 0 % CPU during a request. It waited on its children.
- Sampling the children every 0.2 s during one 7.8 s request found at least 24 `plot-config.sh get <key>` calls (several keys more than once); one `git log -m --first-parent -U0 -G '^[ \t]*[-*][ \t]*\*\*Delivered:\*\*' origin/main -- <plan>` per plan file (`refs-git.ts:652`); `git for-each-ref`, `git rev-parse`, `git rev-list --count HEAD..origin/main` and `git log origin/main --diff-filter=AR --name-status -- docs/plans/`; and `plot-fleetctl.sh --status` for 3.6 s of the window (3.9 s, 4.3 s and once 12.8 s alone, because it reads the worker state of every desk: 22 directories under `.worktrees/`). The sampling misses the shortest children, so the real counts are higher.
- `fleet.ts:2835` states that the `plot-fleetctl.sh --status` ask "is off the request path". The sample saw it inside the request window.
- Load average was 6 to 9, with one spike to 21. Each process start cost about 180 ms while `syspolicyd` ran at 87 % CPU, and 20 ms after it dropped. Every start the request makes multiplies that cost.

Two earlier plans moved the same path: `the-read-path-stops-spawning` (2026-08-31) and `the-scan-spawns-git-once-per-question` (2026-08-20). Both are Released, and this plan does not reopen them: the starts above survived both, so the question is which starts remain and why.

## Design

### Approach

Four required behaviours, from the issue:

1. **Config is read once per file change.** The request path reads a config value from the board's held copy. The copy refreshes when the config file's mtime changes, not once per request and not through `plot-config.sh`.
2. **A Delivered record is read once per `origin/<default>` object id.** The per-plan `git log -G` result is keyed by the object id of `origin/<default>` and reused until that id moves.
3. **The supervisor reading never runs inside a request.** A request reads the last stored reading of `plot-fleetctl.sh --status`. A refresh outside the request path writes it.
4. **A test counts the processes one `/api/board` request starts on a warm board** and fails when the count grows. The count on a warm board is near zero.

Layering follows `CLAUDE.md`: the controller calls the domain, readings reach the domain as values, and only an adapter reaches a process or a script.

### Open Questions

- [ ] Which of the remaining starts (`git for-each-ref`, `git rev-parse`, `git rev-list --count`, the `--diff-filter=AR` log) belong to behaviour 2's object-id key, and which need their own held value?
- [ ] Why did `plot-fleetctl.sh --status` run inside the request window although `fleet.ts:2835` says it does not? A cold first request, a stale stored reading, or a second caller?
- [ ] What counts as "warm" in the test, and what is the allowed count: zero, or a small fixed number with the remaining starts named?

## Slices

### Held values

- `feature/the-board-holds-its-config` — config read once per config-file change, not per request <!-- builds: a config reading held by the board and refreshed on config-file mtime -->
- `feature/a-delivered-record-is-read-once-per-head` — Delivered record read once per `origin/<default>` object id <!-- builds: a Delivered-record reading keyed by origin/<default> object id -->
- `feature/the-supervisor-reading-leaves-the-request` — the request reads the stored `plot-fleetctl.sh --status` reading <!-- builds: a stored supervisor reading read by the request path -->

### Proof

- `feature/a-board-request-counts-its-processes` — test counts the processes one warm `/api/board` request starts and fails when the count grows <!-- builds: a process-count test for /api/board -->

## Notes

- Filed from issue #3017. The plan's `Issue:` field is the only link; nothing is written to the tracker.
- Created unattended: Type came from the prompt, the design question defaulted to `State: Draft`, and the slice split is a first proposal for the reader to change.
