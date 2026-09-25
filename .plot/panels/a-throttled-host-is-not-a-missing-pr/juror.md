# Juror: p985 — a throttled host is not a missing PR

Position: amend
p985: amend
Evidence: executed

## The plan's central mechanism does not exist

**`pr-state` never exits 5. Measured, both backends.** The plan's entire Design table keys on exits 5 and 4 from `pr-state`. Exit 5 is not produced by that op.

Stub `gh`/`bb` on PATH answering a rate limit, real `plot-host.sh`:

```
$ PLOT_HOST=github  plot-host.sh pr-state some-branch
plot-host: HTTP 403: API rate limit exceeded
plot-host: API rate limit already exceeded
GITHUB pr-state EXIT=3

$ PLOT_HOST=bitbucket plot-host.sh pr-state some-branch
plot-host: bb: HTTP 429 - Rate limit for this resource has been exceeded
BITBUCKET branch pr-state EXIT=3

$ PLOT_HOST=bitbucket plot-host.sh pr-state 3636
plot-host: bb: HTTP 429 - Rate limit for this resource has been exceeded
BITBUCKET number pr-state EXIT=3

$ PLOT_HOST=bitbucket plot-host.sh pr-list
plot-host: pr-list: host refused a burst — bb: HTTP 429 - ...
  Nothing is wrong and nothing needs fixing: this limit bounds calls at
  once, not per hour. Retry shortly, with fewer at a time.
pr-list EXIT=6
```

**The reason is structural, not a bug in my stub.** `die5`/`die6` have exactly two call sites in the whole adapter (`plot-host.sh:538`, `:544`), both inside `pr_list_failed()` — the `pr-list` failure classifier. Every one of `pr-state`'s **six** failure paths calls `host_miss_or_fail` instead (`plot-host.sh:3112`, `:3132`, `:3155`, `:3181`, `:3211`, `:3228`), and that function knows nothing about rate:

```bash
host_miss_or_fail() {            # plot-host.sh:1560
  local err="$1" payload="$2"
  if [ -z "$err" ] || is_lookup_miss "$err"; then
    echo "$payload"; return 0
  fi
  echo "plot-host: $err" >&2
  return 3
}
```

`is_rate_refusal` (`:1535`) exists and `pr-state` calls it — but only at `:3149`, to *re-enter the op on the REST route*, never to classify an exit. When REST also refuses, the result falls to `host_miss_or_fail` → 3.

**So the plan's Motivation is half right and its Design is wrong.** The bug is real (`plot-approve.sh:230-231` verified verbatim; `|| pr_json=""` does catch every non-zero exit; `[ -n "$pr_json" ] ||` then manufactures `state:"NONE"`). But the fix as written would add a branch on exit 5 that can never be taken, and the measured Bitbucket 429 would still fall through to today's "no PR found. Push the branch". **The plan would ship, its test would pass against a stub that exits 5, and the reported incident would recur unchanged.**

## What the evidence says the fix actually is

The discriminator available at `plot-approve.sh:230` is **zero vs non-zero**, not a code table. `plot-host.sh:1560`'s contract is already the one the caller needs: *"stdout parseable or empty, exit code decisive"*. A miss arrives on **exit 0 with `state:"NONE"`** — the payload, never the status. Anything non-zero means the host was not asked successfully.

So: capture `rc`, and on any non-zero rc stop with the host's stderr rather than the absence message. That fix needs no change to `plot-host.sh` (which the plan correctly forbids), covers exit 3 — the code the incident actually produced — and subsumes 5, 6 and 4 for free if they ever reach this op.

## Exit 4 — stopping is right, and the plan's own table mislabels it

Verified reachable and permanent:

```
$ PLOT_HOST=gitlab plot-host.sh pr-state some-branch
plot-host: cannot drive 'gitlab' — this script drives github, bitbucket; ...
GITLAB pr-state EXIT=4
```

`backend()` exits 4 before any op runs (`plot-host.sh:2983`, `be="$(backend)" || exit $?`). The plan's worry — *"on a host where pr-state can never answer, stopping means approval is impossible"* — is not a cost to weigh: on such a host `Review: pr` is not a coherent ceremony, and `plot-approve.sh` already refuses any `Review:` other than `pr` by name. Stopping is correct. But the plan's remedy column for 4 says *"stop, say so; do not prescribe a push"* while its own Motivation calls exit 4 *"backend cannot be asked"* — exit 4 is **structurally has no answer**, exit 3 is *could not be asked*, and `run-script.ts:197-199` states the split as the contract:

```
 * | 3 | failed — could not be asked |
 * | 4 | unaskable — this backend structurally has no answer |
```

with a header naming the collapse as the defect: *"Seven adapters writing the mapping themselves is how exit 3 and exit 4 collapse into each other — and collapsing them turns a permanent configuration fact into a transient incident."* The plan is about to make the mirror-image error: it treats 3 as invisible and 5 as the transient, when 3 **is** the transient here.

## Other callers — counted and spot-checked, and the plan undercounts the split

`grep -rln 'pr-state' skills/plot/scripts/` returns 14 files (10 shell, 4 bundles). Real shell call sites: 9.

Spot-check 1 — **`plot-pr-state.sh:33` collapses identically**, and its own comment blesses it:

```bash
PR_JSON=$(bash "$script_dir/plot-host.sh" pr-state "idea/${SLUG}" 2>/dev/null) || PR_JSON=""
```
> `:31` — "a real transport failure lands in the same `|| PR_JSON=""` the old redirect produced."

`:40` then emits `{"found": false}` for both. Same bug, blessed in prose.

Spot-check 2 — **`plot-agent-monitor.sh:249` does NOT collapse**, and is the model the plan should name:

```bash
out=$(bash "$host_script" pr-state "$branch" </dev/null 2>/dev/null) || return 2
```
> `:237` — "THE ADAPTER'S TWO OUTCOMES ARE ALREADY THIS PORT'S TWO. `pr-state` exits 0 with `state:"NONE"` when the host answered and there is no PR, and non-zero when the call itself failed."

Three answers: has-PR / no-PR / **unaskable**. It reads exactly the zero-vs-non-zero line I argue for, and it needs no exit-code table. The plan's open question treats the sweep as unmeasured; one of the two I checked is already correct, and the correct one demonstrates the fix.

## The refusal-to-retry is sound; the argument given for it is not the strongest one

Not retrying is right, but "a retry spends the limit it is waiting on" is weaker than the adapter's own settled reason, which the plan does not cite (`plot-host.sh:406-414`):

> NOT A RETRY, HERE OR ANYWHERE IN THIS ADAPTER. Whether to wait is the caller's decision — a board on a 5 s cadence, a scan inside a 90 s budget and a person at a terminal want three different answers.

And `/plot-approve` is idempotent by design (`plot-approve.sh` header: *"re-running is the repair for any interruption"*), so the operator's retry is the whole command. Nothing is lost by refusing to loop. **Keep the decision; cite the settled reason.**

## The domain already holds this rule, and the plan does not ask it

`packages/domain/src/rules/landed.ts:13`:

```typescript
export type LookupReading = 'found' | 'none' | 'unaskable';
```
> `:4` — "`unaskable` is a THIRD value rather than an empty list, and the distinction..."

`ports/host.ts:24` states the same for PRs: *"`null` means the host was asked and holds no PR for this branch, which is a different fact from a lookup that failed — the latter is a `PortResult` failure and never reaches this type."*

This is the plan's thesis, already settled, already typed, already tested. Under *A Shell Script Asks The Domain*, `plot-approve.sh` runs **once per operator command** — the tier CLAUDE.md says calls the domain, and `plot-approve.sh` already does elsewhere. The plan's Motivation reaches for `plot-detect-repo.sh:94` and `plot-board-probe.sh` as precedent when `landed.ts` is the rule itself. This need not become a new bundle; but the plan must name `LookupReading` as the vocabulary it implements and say why shell decides here, rather than inventing a fourth precedent.

## Two smaller findings

**Exit 6 is unmentioned.** The adapter answers **three** refusal codes, and `plot-host.sh:416-438` makes the 5/6 split load-bearing: *"A caller told only *throttled* counsels one when it means the other: it waits minutes for a limit that cleared, or it retries in seconds into a bucket that is empty."* A plan whose table enumerates codes and omits 6 re-creates the collapse it is fixing. (Moot if the fix is zero-vs-non-zero — which is an argument for that shape.)

**`plot-host.sh:401` and the quoted message verify exactly.** Line 401 is the `# Exit 5 —` comment opening; `plot-approve.sh:243-245` carries the three-line "no PR found … Push the branch … or run /plot-idea" message the plan quotes, word for word.

## What must change

1. **Replace the exit-code table with the zero-vs-non-zero reading.** Non-zero from `pr-state` = the host was not asked; stop with its stderr. A miss is `state:"NONE"` on exit 0, unchanged. Say explicitly that **exit 3 is the code the measured incident produced**.
2. **Correct the Motivation.** It claims exit 5 reaches the caller and is discarded. It never reaches the caller. Name `host_miss_or_fail` (`plot-host.sh:1560`) as where `pr-state`'s failures are classified, and `pr_list_failed` (`:528`) as the only place 5 and 6 are spent.
3. **Fix the exit-3/exit-4 wording** against `run-script.ts:197-199`: 3 is *could not be asked*, 4 is *structurally has no answer*. Keep "stop" for both; drop the doubt about 4.
4. **Rewrite Done-when's test line.** "a stub that exits 0-with-PR, 0-empty, 4, and 5" would pass against a mechanism that does not fire. The arms must be **0-with-PR, 0-with-NONE, and non-zero (3)**, with 4 and 5 as extra non-zero cases proving the one branch covers them.
5. **Name `landed.ts`'s `LookupReading`** as the rule this implements, and state why the decision stays in shell.
6. **Amend the open question with the measurement taken here:** 9 shell call sites; `plot-pr-state.sh:33` collapses the same way and its comment blesses it; `plot-agent-monitor.sh:249` already reads it correctly and is the worked example.

The diagnosis is right and the incident is real. The mechanism is not. `amend`, not `reject` — one slice, and the correction makes it smaller.
