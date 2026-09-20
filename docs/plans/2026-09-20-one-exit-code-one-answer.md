# One exit code, one answer

> `exit 7` means *partial answer, keep the rows* to the `Scripts` port and *total refusal* to the host port, because a code taught to one adapter was never taught to the other.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Rounds:** 1
- **Approved:** 2026-09-20, jwloka, in-session
- **Impl:** own branches
- **Started:** 2026-09-20, Jan Wloka, `bug/the-port-answers-partial`

## Changelog

- The host port reads a partial PR list as partial rather than as a refusal, so a caller on the multi-state route keeps the rows the host returned instead of discarding them.

<!-- Board impact: none today. No consumer of the host port takes the
     multi-state route yet; this closes a contract gap ahead of one. -->

## Design

`a-partial-page-is-not-an-outage` (#951) taught `plot-host.sh` to exit **7** for
a partial `pr-list` — some states answered, some did not — and taught
`scripts-shell.ts` to read it. **It did not teach the host port.**

| reader | exit 7 | the rows |
|---|---|---|
| `scripts-shell.ts:100` `hostSaid` | `{ answer: 'partial', stdout, said }` | **kept** |
| `host-shell.ts` `record()` | `refusalKindOfExit(7)` → `'failed'` | **discarded** |

`refusalKindOfExit` knows `EXIT_QUOTA = 5` and `EXIT_SECONDARY = 6` and returns
`'failed'` for everything else. Seven is everything else.

**This is a defect in my own merged work.** The panel that reviewed #951 asked
about callers and I answered for `plot-fleet-scan.sh`, which was the caller the
issue named — not for the port.

### It is a contract gap today, not a live symptom

**An earlier draft of this plan claimed it explained a live board showing seven
rows as `no PR ever opened`. Three lenses refuted that, and the refutation is
measured:**

- **A single-state call cannot return 7.** `plot-host.sh:587` states it — *"With
  one state asked, 'some answered and some did not' is unreachable by
  construction"* — and a stubbed run confirms it: `--state merged` with a failing
  host exits **3**, never 7. `prList(state, limit)` passes one state, so the
  port's route cannot produce the code this plan fixes.
- **The route that CAN return 7 already handles it.** `fleet.ts:2477` asks
  `--state all` through `hostSaid`, and `:2494` keeps the rows on `partial`.
- **The live board was three days stale.** Process start 2026-09-17 07:08,
  against `plot-host.sh` written 09-18 17:08 and the bundle 09-20 13:51. It was
  running an in-memory image of code that no longer exists on disk, with no
  supervisor to restart it.
- **The host call is slow and variable**, which is the likeliest trigger for the
  symptom: measured the same afternoon at 16 s, 22 s, 25 s — and once at **90 s,
  exit 124**. A caller with a bound shorter than the tail gets a killed child, a
  derived non-zero code, and `said` built from the accumulated stderr. That is
  latency, not this defect, and it is somebody's plan.

**So this plan fixes a contract, not a screen.** `prList`'s only consumer today
is `registryd-main.ts:436`, a merge-queue reading that renders no rows. The
value is that the next caller to take the multi-state route through the port
gets the rows rather than a refusal.

### The two adapters must not agree about meaning

An earlier draft demanded *"both adapters agree for every code they know"*. That
is wrong, and the port says why. `host-shell` is a **connector**: it answers
*how long to wait*, so it splits 5 into `throttled` and 6 into `secondary`.
`hostSaid` is the generic `Scripts` port and collapses both to `failed`, because
it carries no limit vocabulary. Forcing agreement would lift connector words
onto every filesystem port — the mistake `ports/host.ts:100` names.

**What is shared is the NUMBERS.** And the duplication the earlier draft cited
does not exist: `scripts-shell.ts` defines no exit constants at all, it uses
bare literals. So a shared module is worth writing on its own merits — one place
that says which integer is which condition — and each adapter keeps its own
reading of what that condition means for its callers.

### `PortResult` is untouched

A fourth arm would reach every consumer. The partial answer is expressible with
what the port already has: the rows through the normal answer, the sentence
through the refusal reading the port already exposes.

## Slices

### The port answers partial (Branch: bug/the-port-answers-partial)

- `bug/the-port-answers-partial` — `host-shell.ts` reads exit 7 as an answer carrying rows, not a refusal, and the exit-code numbers are named in one file

**Done when** `record()` treats exit 7 as an answer that keeps its rows while
still reporting what was missing, pinned by a test with a PATH-stubbed `bb` that
fails one of three states; `refusalKindOfExit(7)` no longer returns `'failed'`,
pinned — **it has no test today, so this writes the first one**; `PortResult`
gains no new arm and its consumers are untouched, stated and checked; the exit
codes are defined in **one file both adapters import**, naming the numbers only
— each adapter keeps its own meanings, because a connector answers *how long to
wait* and the `Scripts` port must not; that file's name does not collide with
`ci.yml`'s `ports/` rule; exits 3, 5 and 6 are **byte-identical** in behaviour,
pinned per code; `prList`'s single-state route is unaffected, since 7 is
unreachable there by construction; and `pnpm run test:contracts` passes.

## Notes

**Three lenses, three `amend`, and the plan lost half its size and all of its
causal claim.** Record in `.plot/panels/2026-09-20-one-exit-code-one-answer/`.

**A second slice was cut entirely.** It proposed making a failed `pr-list` state
return to the collector rather than `exit` the script — on the belief that an
`exit` ends the run. It does not: `pr_list_call` is invoked inside a command
substitution, so the `exit` leaves a **subshell** and the code is captured and
classified. The script documents this twice, at `:518` and `:569`, in the two
function headers the draft quoted from. Proved by running the real script with a
stubbed `bb`: **exit 7, the answering state's row on stdout**. And
`test/reconcile/host.test.mjs:1038` already pins it, under the banner *"A PARTIAL
ANSWER IS NOT AN OUTAGE (#912)"*.

**The die count was wrong too** — 18 `die` and 3 `die3`, not 17 and 3 — and
irrelevant either way, since none of them reaches the pr-list path as the draft
claimed.

**Seven hypotheses were refuted before this one**, three of them spot-checked by
a juror and all three holding: the empty shim directory, 19 KB against a 10 MB
`maxBuffer`, and concurrency. They are recorded so the next reader does not
re-run them.
