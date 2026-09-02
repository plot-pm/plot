---
'plot': minor
'@plot-pm/domain': minor
---

Every host call appends one line to a budget record the whole computer shares,
and the spend rate is readable back over the connector's own window.

The number nothing could see before. `plot-host.sh` makes ~40 host CLI calls
across 14 backend branches and counted none of them, so a component asking
*what is this account spending* had one honest answer: ask the host, spending a
request to find out. Measured 2026-09-01, `gh api rate_limit` reported 5000
while the response headers on the same account read 0 — so that answer was both
expensive and wrong.

**Instrumented by shadowing, not by editing 40 call sites.** `gh`, `bb` and
`jen` are now shell functions that forward argv untouched, preserve stdout,
stderr and the exit code, and append afterwards; `command gh` reaches the real
binary. Forty edits would all have to stay right, and the arm that drifts is the
one nobody's repo exercises. A wrapper also counts a call site written next
year. Jira is counted inside `jira_curl` instead, because it is reached through
`curl` and shadowing `curl` would count every unrelated use of it.

**A refusal appends a line too.** GitHub debits the request before it decides to
refuse it, so a record blind to failures reads a throttled account as an idle
one — under-counting exactly when the count matters most.

**Lock-free, and the line cap is the guarantee.** Concurrent `O_APPEND` is
atomic only below `PIPE_BUF`, which `getconf PIPE_BUF /` reports as 512 on this
fleet's macOS machines rather than the 4096 a reader assuming Linux would take.
Every line is measured in bytes before it is written, and an over-long one is
**refused with a message on stderr rather than shortened**: a torn line loses
the concurrent writer's line as well, so dropping one spend is cheaper than
corrupting another's. Asserted with real concurrency at lines near the cap, not
by argument.

**The record is the computer's, not the checkout's.** Two GitHub checkouts here
share the account `jwloka`, so a per-checkout `.plot/state/` would let each read
a full 5000 while the other spent it — the over-spend the record exists to
prevent, reproduced by storing it in the wrong place. `$PLOT_BUDGET_HOME` is the
one override, the same variable `budget-file.ts` reads.

**The rate is derived over the window, never the whole file.** One board at 5 s
and eleven scripts at 90 s append ~1,160 lines an hour; a rate divided by an
ever-growing span approaches zero, and a cadence derived from it would relax
forever. The window starts at the latest reset that has already **passed** — a
reset still in the future says only that the window has not closed, and
subtracting an hour from one an hour out lands on `now` and discards every line
ever written.

**Absent is never zero, and `unknown` is never free.** A `remaining` of 0 means
the bucket is spent; `-` means the connector did not say. A connector this
wrapper holds no reading for records `unknown`, and `headroom()` answers null
for it by construction — so a caller can tell a recorded zero from an unread
one. `plot-host.sh spend-rate` reads the record back and asks no host.

`packages/domain/src/rules/budget-record.ts` is the reader's half — the window
filter, the per-budget grouping truncation needs, and the rate. The format is
written twice, in shell and in TypeScript, because the spenders are eleven shell
scripts and a person at a terminal: starting `node` to record one call would add
~40 ms and a runtime dependency to every host call plot makes. A contract test
decodes real shell output with `decodeEntry` and pins the two together.

No behaviour change beyond the record: a call that succeeds today succeeds
identically with a line appended, and `PLOT_BUDGET_OFF=1` disables recording for
the tests that prove it.

<!--
bumps:
  plot: minor
-->
