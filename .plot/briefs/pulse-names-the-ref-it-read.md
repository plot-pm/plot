# Brief: bug/pulse-names-the-ref-it-read

Implement `docs/plans/2026-08-18-the-pulse-names-the-ref-it-read.md`.

Read that plan first. Its diagnosis was measured, not inferred: **do not
re-derive it, do not widen the scope.**

## The bug

`plot-fleet-scan.sh` builds its banner from local `HEAD` while reading
`origin/$MAIN`:

```
943:  HEAD_SHORT=$(git rev-parse --short HEAD 2>/dev/null)
970:  banner="plot-fleet pulse — $HEAD_SHORT on origin/$MAIN"
```

Measured 2026-08-18, standing on a feature branch:

```
scan header: plot-fleet pulse — 91a9a60 on origin/main
local HEAD:  91a9a60
origin/main: ee199aa
```

The sentence is false in the only part a reader uses. The same value travels in
the `--json` payload (line 1227) as `head`, so every consumer — the board's
Agents tab included — inherits it.

## What to build

1. Report the ref actually read: `origin/$MAIN`, not `HEAD`.
2. Say so when the local checkout differs from what was read — the operator's
   tree and this report disagree, and that is worth one clause.
3. `--json` gains `read_ref` and `local_head`. **Keep `head` as an alias** for
   one release; the board reads it today and must not break.
4. When `origin/$MAIN` cannot be resolved (no remote, fresh clone), report the
   ref as unknown. **Do not silently fall back to `HEAD`** — that reintroduces
   this exact bug in the case where it is hardest to notice.

## The test is the load-bearing part

It must **construct the divergence**: commit to `origin/$MAIN` in a sandbox
without fast-forwarding the local checkout, then assert the banner names the
origin ref. A test written where the two refs happen to agree passes against the
buggy code and proves nothing.

`test/reconcile/` holds the contract tests; follow the sandbox style in
`scan.test.mjs` and `fleet.test.mjs`.

## Out of scope

**Do not make the scan fetch.** It is read-only and stateless by design
(Manifesto Principle 1). Reporting staleness is the fix; curing it is the
operator's call.

**Do not touch plan enumeration or merge detection.** Two sibling branches are
in flight on this same file:
- `bug/a-squashed-branch-is-merged-not-open` — merge detection
- `bug/the-scan-enumerates-the-ref` — plan enumeration (queued behind you)

Keep your diff to the banner and the JSON fields so the three do not collide.

## Definition of Done

- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` all pass
- A test that fails against the current code and passes against yours
- `pnpm run test:board` passes (the board reads `head`; prove the alias works)
- A changeset with a `bumps:` block naming `plot: patch`

## Platform note

CI runs Linux; you are probably on macOS. Two faults were found this way today —
`stat -f` does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated
PATH because CI ships a real `gh` there. If your test shells out, consider what
it does on the other platform before pushing.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
