# Juror: the adapter

Position: amend

Lens: this plan changes when `plot-host.sh pr-list` exits non-zero. Every finding
below is about what reads that exit code.

---

## What I confirmed (the plan is right about the mechanism)

**The three loop sites are exactly where the plan says**, and all three carry
`|| exit $?` inside a `for _s in $bb_states` loop:

```
3117:          for _s in $bb_states; do
3118:            _bb_raw="$(pr_list_call bb ... pr list --state "$_s" --json)" || exit $?
3146:          for _s in $bb_states; do
3147:            _bb_raw="$(pr_list_call bb ... pr list --state "$_s" --json)" || exit $?
3155:        for _s in $bb_states; do
3156:          _bb_raw="$(pr_list_call bb ... pr list --state "$_s" --json)" || exit $?
```

**The GitHub arm claim is true.** `pr_list_call gh` appears at `:3018`, `:3047`,
`:3078` — three call sites, each passing `--state "$state"` (the caller's word,
`all` included) in ONE call, none inside a state loop. `grep -n 'for _s in'`
returns only `:2640` (an unrelated op) and the three Bitbucket ones. The GitHub
arm genuinely cannot reach the partial-output shape.

**`pr_list_failed` exits 3/5/6 as claimed** (`plot-host.sh:476-501`): `secondary`
→ 6, `throttled` → 5, everything else → 3. None is 4.

**`hostSaid` discards stdout on every one of them**
(`adapters/scripts/scripts-shell.ts:88-90`):

```ts
if (run.code === 0) return { answer: 'answered', stdout: run.stdout };
const said = run.stderr.trim() || run.stdout.trim() || `plot-host.sh exited ${run.code}`;
return run.code === 4 ? { answer: 'unaskable', said } : { answer: 'failed', said };
```

`stdout` travels only on `answered`. Confirmed.

**I reproduced the defect** with a PATH-stubbed `bb` (open + merged answer,
declined emits `error: API rate limit exceeded`, exit 1):

```
rc=5
STDOUT:
{"number":358,"title":"A","state":"OPEN","head":"feature/a"}
{"number":300,"title":"B","state":"MERGED","head":"feature/b"}
STDERR:
plot-host: pr-list: host throttled — error: API rate limit exceeded
```

Two complete rows on stdout beside exit 5, which `hostSaid` then drops. The
plan's causal chain is **real, not theoretical**.

## The reachability challenge: the shape IS reachable

I was asked whether a per-state failure is possible or whether failures are
all-or-nothing. **It is reachable**, and the "all-or-nothing" refutation fails:

1. `bb` 1.9.0 is installed here. It exits **1** on error with text on **stderr**
   (measured — an earlier pipe-masked read showed rc=0 and was wrong):
   ```
   state=open rc=1 stderr='error: origin remote is not a bitbucket.org URL...'
   ```
   So a failing state does reach `pr_list_call` as a non-zero exit.
2. The three states are **three separate HTTP calls** made sequentially. A quota
   that is spent partway through is the ordinary case, not a contrived one: calls
   1 and 2 succeed, call 3 crosses the boundary. That is the normal way a rate
   limit is encountered by a loop, not a stub artefact.
3. `bb pr list --state declined` on a repo with no declined PRs returns an empty
   list, not an error — so "declined always fails" is not the mechanism, and does
   not need to be.

A throttle does NOT hit all three equally, because they are not simultaneous.
**I could not refute reachability.** The plan describes a real shape.

## My finding: the plan breaks a caller it does not name — and says it does not

This is the amendment, and it is the strongest thing I found.

The plan asserts under *What this is NOT*:

> **Not a change to the failure vocabulary.** Exits 3/5/6 keep their meanings,
> and a run where **no** state answered still fails with the same code, so
> **every backoff caller behaves as today.**

That last clause is **false for `plot-fleet-scan.sh`** — the caller that produced
#912's nine rows. It does not read `hostSaid`; it reads the exit code directly
and branches on 5 / 6 / 4 (`plot-fleet-scan.sh:675-702`):

```bash
host_err=$("$script_dir/plot-host.sh" pr-list --state all --limit "$PR_LIST_LIMIT" --rich ...); rc=$?
if [ "$rc" -ne 0 ]; then
  case "$rc" in
    5) HOST_VERDICT=throttled ;;
    6) HOST_VERDICT=secondary ;;
    4) HOST_VERDICT=unasked ;;
```

Under the fix, the partial run exits **0**, so `rc -ne 0` is false and
`HOST_VERDICT=ok` (`:746`). The scan then reports a **complete** host reading
over a page that is missing a whole state, and the operator advice at `:4253-4267`
— *"the git host's rate limit was spent ... re-run in a few minutes"* — **never
prints**. `HOST_VERDICT` also travels into the machine-readable footer
(`:4331: host=$HOST_VERDICT`) and into per-branch notes (`:3741`), so the
incompleteness becomes invisible to every consumer of the scan, not just to a
reader.

This is the plan's own stated red line, violated by its own fix:

> The one thing this must not do is report a short list as complete — the
> *"quiet wrong answer this adapter refuses elsewhere"*.

stderr does not save it. The scan captures stderr into `$host_err` but consults
it **only inside the `rc -ne 0` branch**. On exit 0 the stderr text is collected
and never examined. So the plan's "name the failed state on stderr" lands in a
variable nobody reads on the success path — the fix's only honesty mechanism is
inert at exactly the caller the bug was reported from.

There is a second, milder instance: `plot-fleet-scan.sh:663-668` comments that
this guard *"until 2026-08-30 never fired, because `pr-list` swallowed its own
failure and exited 0 with empty stdout. Now that it can fail..."*. The fix
partially re-introduces the state that comment records as a fixed defect.

## Callers I checked and cleared

- `plot-open-pr.sh:138` — `pr-list --state all --limit 200`, `2>/dev/null`,
  `|| pr_rows=""`. Already ignores the exit code. Under the fix it gets MORE
  rows than today (today: none), so its "is a PR already open" check gets
  strictly better. Its refusal is `existing_pr` by number; a missing declined
  state cannot produce a false positive, only the false negative it already has.
  **Improved, not harmed.**
- `plot-impl-status.sh:170` — `--state merged`, a SINGLE state. Never enters the
  partial shape. Unaffected.
- `plot-reconcile-scan.sh:473,503` — `--state open` and `--state merged`, both
  single-state. `:473` reads `rc` and sets `PR_SOURCE=failed`; with one state
  there is no partial answer, so it keeps today's behaviour exactly.
- `host-shell.ts` / `refusalKindOfExit` (`:149-151`) and `observe()` (`:344`) —
  these drive the rate-limit correction in `rules/reaction.ts`. A partial run
  exiting 0 means `record()` clears `refusal` to `null` and `observe('throttled')`
  is never called, so `correctForRefusal` does not lower the predicted ceiling.
  Real but second-order: a throttle that goes unrecorded means the next pass
  does not back off. Worth naming in the plan; not by itself blocking.
- `scripts/check-host-cli-callers.sh` — a **path check** with a named exception
  list, flagging `gh`/`bb` invocations outside `plot-host.sh`. The fix stays
  inside `plot-host.sh`, so the gate is satisfied unchanged. **No concern.**

## Single-state safety: the plan's claim holds, and the shape is natural

Measured with an always-failing stub:

```
--state open  (single) → rc=5, stdout empty
--state all   (all three fail) → rc=5, stdout empty
```

Both already behave as the plan requires. With `bb_states_for` resolving `open`
to a one-element list, "exit non-zero when none answered" collapses to "exit
non-zero" for a single state with no special case. The code shape makes this
natural rather than an exception — the plan is right here.

## The reporting shape already exists and should be reused

`pr_list_report_truncation` (`plot-host.sh:1916-1929`) is precisely the
precedent: a per-state stderr line, already called inside all three Bitbucket
loops, whose header argues stderr-only *because* both consumers parse every
stdout line as a PR record and a sentinel would enter the join as a phantom
`{number:undefined}`. A second reporting shape should not be invented. Note this
is also evidence that the fix must NOT put the missing-state notice on stdout.

## What would change my position to proceed

Add a Done-when item binding the caller, not just the adapter. Something that
forces the partial answer to stay *visible* to `plot-fleet-scan.sh`:

- either the scan learns a fourth verdict (e.g. `partial`) and the exit code
  carries it — a distinct non-zero code that means *some states answered*, which
  keeps `rc -ne 0` true for every existing reader while letting `hostSaid` be
  taught to pass stdout for that one code;
- or `hostSaid` gains an `answer: 'partial'` with `stdout` AND `said`, which is
  the "shape change in `HostAnswer`" the plan defers in its closing note — the
  plan defers exactly the mechanism that would make its own fix honest;
- or, at minimum, the scan is changed in the same slice to read the stderr marker
  on the exit-0 path and set `HOST_VERDICT` accordingly.

The single slice as written changes the adapter and leaves the caller reading
`ok`. The plan is correct in its diagnosis, correct about GitHub, correct about
reachability, and correct that the rows should survive. It is wrong in one
sentence — *"every backoff caller behaves as today"* — and that sentence is load
bearing, because the caller it is wrong about is the one that produced #912.

