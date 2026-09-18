# Juror: the reporter's problem (#912)

Position: reject

Lens: an operator on `quaweb-website` with three open PRs and nine branches
labelled `commits, no PR ever opened`. Does shipping this plan fix THEIR board?

**No. The plan's cause requires a non-zero exit. The reporter's evidence shows exit 0,
and I reproduced their banner byte-for-byte from a run in which every state SUCCEEDED.**

## Finding 1 (strongest): the reporter's symptom reproduces at exit 0, which the plan's cause cannot produce

The plan's whole mechanism is "a state FAILED after earlier states printed rows,
and the non-zero exit discards them at the transport":

> `pr_list_failed` exits **5** (throttled), **6** (burst refusal) or **3**
> (everything else), and none of those is `4`, so all three become `failed`.

I ran the reporter's exact command against a PATH-stubbed `bb` in which **all three
states return successfully** — the reporter's own stated situation, three open PRs,
nothing throttled:

```
$ PATH=<stub>:$PATH PLOT_HOST=bitbucket bash skills/plot/scripts/plot-host.sh \
    pr-list --rich --state all --limit 1000
EXIT=0
--- STDERR ---
plot-host: bitbucket ignores --limit 1000; bb returns a fixed page (50 at 1.0.0)
plot-host: bitbucket pr-list state=open possibly truncated (3 rows, requested limit 1000 unprovable) — a join against this page may read older branches as 'no PR' (#333)
--- STDOUT ---
{"number":445,...}
{"number":405,...,"head":"feature/ki-lp-conversion-events",...}
{"number":358,...,"head":"improvement/QUACDS-958-standardize-ports",...}
```

Compare to the reporter's banner in #912:

```
PR data unavailable (plot-host: bitbucket ignores --limit 1000; bb returns a fixed page (50 at 1.0.0)
plot-host: bitbucket pr-list state=open possibly truncated (3 rows, requested limit 1000 unprovable) …
```

**Both stderr lines match exactly, including the row count `3`.** Their banner is
this stderr text, verbatim, from a run that exited 0. The plan is built on a cause
whose signature is absent from the report it cites.

Also reproduced: the reporter's control case.

```
$ plot-host.sh pr-list --rich      # no --limit
EXIT(no --limit)=0   stderr lines: 0   stdout rows: 3
```

Identical to their `"3 PRs, zero stderr lines"`. The reporter's diagnosis —
`"So the adapter behaves correctly"` — is correct at the adapter.

## Finding 2: the plan's refutation #2 is wrong on the load-bearing half

The plan rules out the stderr hypothesis:

> 2. **"A stderr warning causes the throw."** `hostSaid` ignores stderr entirely.

`hostSaid` ignores stderr *for deciding the answer word*. It does **not** ignore
stderr for the message, and the message is the whole banner
(`packages/domain/src/adapters/scripts/scripts-shell.ts:88-90`):

```ts
if (run.code === 0) return { answer: 'answered', stdout: run.stdout };
const said = run.stderr.trim() || run.stdout.trim() || `plot-host.sh exited ${run.code}`;
return run.code === 4 ? { answer: 'unaskable', said } : { answer: 'failed', said };
```

`said` is `run.stderr.trim()` — **every stderr line, joined**. That becomes
`throw new Error(said.said)` (`fleet.ts:2481`), then `entry.prError = message`
(`fleet.ts:2570`), then `PR data unavailable (${fleet.prError})`
(`host-notes.ts:370`). The truncation warning reaching the banner is not a
hypothesis — it is the only route by which that text can appear there, and the
plan dismissed it by answering a different question.

The plan's counter-measurement is also from the wrong host:

> Measured here: `pr-list --rich --state all --limit 1000` → **exit 0**, 925 rows,
> 0 stderr lines.

"Here" is this repo, which is **GitHub**. `pr_list_report_truncation` returns early
for GitHub when `count < limit` (`plot-host.sh:1922-1924`), so 925 < 1000 prints
nothing. On Bitbucket the same function **always** fires for any non-empty page with
a `--limit` (`:1924-1927` — "any non-empty page for a --limit call is unprovable").
A GitHub measurement cannot exclude a Bitbucket-only warning.

## Finding 3: no version gap rescues the plan

I checked whether the reporter's plot 2.16.1 differs from main on either path.

```
$ git show v2.16.1:.../scripts-shell.ts | grep -n 'run.stderr.trim'
89:  const said = run.stderr.trim() || run.stdout.trim() || ...
$ git show v2.16.1:skills/plot/scripts/plot-host.sh | grep -n 'possibly truncated'
1732: echo "plot-host: $be pr-list state=$state possibly truncated ($count rows, ...
```

Identical. Running the v2.16.1 script itself against the same stub: `EXIT=0`,
3 rows. The reporter is not on divergent code.

## Finding 4: the reporter's own fix is the one the plan drops

#912 names the defect precisely and the plan does not build it:

> `3 rows, requested limit 1000 unprovable` measures the returned count against the
> **requested** limit. The page size is 50. Three rows on a fifty-row page is
> *provably* complete — nothing was cut.

That is a real, currently-shipping bug at `plot-host.sh:1924-1927`, and it is the
one that produces their stderr. The plan explicitly declines it ("**Not #333**"),
and #912 is not #333 either — it is a third thing: *the completeness check for
Bitbucket compares against a number the host ignored*.

The reporter's second suggestion — "when `prError` is a *completeness* warning
rather than a failure, the board should still join against the rows it received" —
is also unbuilt. The plan's `Changelog` promises their outcome
("A repository with three open PRs stops showing nine branches as having no PR")
while its slice changes only the multi-state exit code.

## Walking the reporter's nine rows through the proposed code

Their run has no failing state. The slice's change — "exit non-zero only when none
answered" — is reached only on a `pr_list_call` failure. In their run that branch
never executes; exit is already 0. **The nine rows are unchanged after this ships.**

## What would have to be true for the plan to be right

The reporter would have to have had a state failing at the moment the board
fetched, while their hand-run of the same command minutes later succeeded. Possible
in principle, but then their banner's `(3 rows, ...)` line would have to come from
that same failing run — and a run that reached the throttle on state 2 or 3 prints
the throttle message too (I observed it: `plot-host: pr-list: host throttled`).
Their banner carries no such line. The evidence points one way.

## What I am NOT claiming

The plan's described defect is **real**. The Bitbucket arm does `|| exit $?` after
printing rows (`:3118`, `:3147`, `:3156`), and `hostSaid` does drop stdout on a
non-zero exit. That is a genuine latent bug worth fixing. My objection is about
**attribution**: it is not #912's cause, and the plan closes #912 on it.

## Amendment that would move me

Re-scope to the reporter's actual defect and cite this measurement:

1. Compare Bitbucket's row count to the **effective page size** (50), not the
   dropped `--limit`. `rows < page_size` proves completeness → no warning → no
   `prError` → the three PRs join and the two branches stop reading as abandoned.
2. Separate a *completeness warning* from a *failure* at the transport, so a
   warning on stderr never becomes `prError` on a run that exited 0.

The partial-exit fix is a sound second plan. It should not be filed as #912's.

