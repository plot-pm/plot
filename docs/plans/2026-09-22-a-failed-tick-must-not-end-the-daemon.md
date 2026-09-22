# A failed tick must not end the daemon

> The supervisor's loop has no `catch`, so one rejected tick ends the process — and `launchd` does not restart it, because `KeepAlive` was never the thing keeping it alive.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-22, jwloka, in-session

## Changelog

- A tick that throws no longer ends the supervisor. The loop had no error handling at all, so a single rejected promise anywhere in a tick took the daemon down and the fleet stopped handing over work — measured twice in ninety minutes, both times leaving the launchd label loaded and an operator told the supervisor was running.

Board impact: none directly. What changes is that the fleet keeps handing work over after a tick fails.

## Design

### The promise the code does not keep

CLAUDE.md states the supervisor's contract:

> **A tick that cannot complete reports and the loop continues** — the reason goes to stderr, the decision is empty rather than truncated, and the next tick re-reads the registry and the desks from disk.

**There is no `catch` anywhere on that path.** `registryd-main.ts:807`:

```ts
for (;;) {
  if (stop()) return 0;
  const report = await tick({ … });      // ← no try
  …
  await sleep(args.intervalMs);
}
```

and the entry point:

```ts
void run(process.argv.slice(2), …).then((code) => process.exit(code));   // ← no .catch
```

`grep -c catch` over the tick path returns **zero**. The `catch` blocks in the file are per-file-read (`:217`, `:657`, `:669`) — they protect individual reads, not the tick.

**So a rejected promise from `tick` — a git command that fails, a host call that throws, a manifest that disappears mid-read — is an unhandled rejection, and Node ends the process.**

### Why launchd does not bring it back

The unit sets `KeepAlive: true`, which should restart it. Measured: it does not.

```
launchctl print … → state = running, runs = 1, last exit code = (never exited)
```

**`runs = 1`.** Over a period in which the process died twice, launchd counted one start. The label stayed loaded with no process under it, which is exactly the state `--status` reports as `supervisor: running` — and is why the death was invisible for hours.

**Diagnosing launchd's behaviour is not this plan's job.** The daemon must not rely on being restarted, because the contract it publishes says it survives a failed tick on its own.

### The fix is the contract, written down

```ts
for (;;) {
  if (stop()) return 0;
  try {
    const report = await tick({ … });
    …
  } catch (err) {
    warn(`tick failed: ${…}`);          // stderr, as the contract says
  }
  await sleep(args.intervalMs);
}
```

**The `catch` goes around the tick and inside the loop**, so the next iteration re-reads everything from disk — which is the contract's own recovery story: *"there is no journal, no lock file and no resume path, because the recovery from a failed tick and the recovery from a `kill -9` are one code path."*

**A `.catch` on the entry point is the second half**, and it is not a substitute. It turns an unhandled rejection into a reported exit rather than a silent one, for the failures the loop's `catch` cannot see — an error thrown while parsing arguments, before the loop starts.

### What must not break

**`--once` must still exit non-zero on a failed tick.** A gate that swallowed the failure would report a healthy daemon to an operator installing one. The `catch` must distinguish: looping continues, `--once` returns the failure.

**The reported decision stays empty rather than truncated.** A tick that failed halfway has decided nothing, and the contract says so. The `catch` must not emit a partial report.

**`stop()` keeps its meaning.** It exists for tests and returns `false` in production; it is not an error path and must not be confused with one.

**The failure must reach stderr, not stdout.** `registryd.err` was empty on both deaths, which is itself evidence: the process was not reporting, it was vanishing. A caught tick failure that printed to the tick log would be as invisible as the crash was.

## Slices

### The loop survives a failed tick (Branch: bug/the-loop-survives-a-failed-tick) <!-- deferred: built directly on main 2026-09-22 (65071ef52) and verified by injected throw. The delivery panel refuted it for MISSING TESTS, not missing code — that is a follow-up, not a dispatch -->

- `bug/the-loop-survives-a-failed-tick` — the tick is wrapped in `try`/`catch` inside the loop, the failure is reported to stderr with the error's own text, and the loop sleeps and continues; `--once` still returns non-zero on a failed tick; the entry point gains a `.catch` that reports and exits non-zero rather than dying silently. Tests pin that a throwing tick leaves the loop running, that the next tick is attempted, that `--once` does not swallow it, and that the report is empty rather than partial

## Notes

- Found by asking why the daemon dies, after `a-loaded-label-is-not-a-running-daemon` made the deaths visible. That plan reports the symptom; this one removes one cause.
- **It may not be the only cause.** This removes the class *a tick threw*; a death from memory pressure or a signal would look the same from outside. The `catch` makes the difference observable: a surviving daemon that logs a tick failure has hit this class, and one that still vanishes has not.
