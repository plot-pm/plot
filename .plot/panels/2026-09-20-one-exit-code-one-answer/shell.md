# Juror: the shell

Position: amend

**Amend = delete slice 2.** Slice 1 is untouched by this verdict and I did not review it. Slice 2 rests on a claim about bash that is false, and the behaviour it proposes to build already exists on main and is already pinned by five passing tests.

## 1. The central shell claim is false, and the script's own comments say so

The plan's Design section states:

> But `plot-host.sh` carries **20 `die` calls** (17 `die`, 3 `die3`), and `die` runs `exit 1`. An `exit` ends the script, so the collector never runs, `_ok` is never read, and the classification **does not happen**. Rows already printed go out with a code that says total refusal, and nobody decided that.

Every clause after "and `die` runs `exit 1`" is wrong for the pr-list path.

`pr_list_call` is invoked inside a command substitution, so the `exit` inside `pr_list_failed` ends the **subshell**, not the script. The rc is captured and classified. `plot-host.sh:606`:

```bash
_raw="$(pr_list_call "$@" --state "$_s" --json 2>"$_tmp")"; _rc=$?
```

This is not an accident anyone has to infer. `plot-host.sh:518-524`, the header of `pr_list_call`, states it as a standing contract:

```
# EVERY CALL SITE MUST WRITE `|| exit $?`, AND IT IS NOT OPTIONAL. This is
# invoked as `_raw="$(pr_list_call …)"` — a COMMAND SUBSTITUTION, which is a
# subshell — so the `exit` inside `die5`/`die3` leaves that subshell only.
```

And `plot-host.sh:569-577`, the header of `pr_list_states`, states the deliberate exception for the loop:

```
# WHY THE LOOP CANNOT KEEP `|| exit $?`. That propagation is not a style tic:
# `pr_list_call` is invoked in a command substitution — a subshell — so the
# `exit` inside `pr_list_failed` leaves only that subshell … Collecting across
# states means the first failure can no longer end the run, so the subshell's
# exit code is captured and classified instead
```

The plan proposes to build the thing the source file documents as already built, on the grounds that the subshell semantics work the opposite of how they work.

## 2. Proved against the real script, not a stub

`bb` stubbed on PATH, `open` answering and `merged`/`declined` returning 1:

```
$ PLOT_HOST=bitbucket PLOT_BB_SKIP_CAP_CHECK=1 bash skills/plot/scripts/plot-host.sh pr-list --state all
REAL SCRIPT EXIT=7
--- stdout:
{"number":1,"title":"t","state":"OPEN","head":"b"}
--- stderr:
plot-host: pr-list: HTTP 503 service unavailable
  Check the CLI can answer: bb auth status
  If it is not logged in: bb auth login
plot-host: pr-list: HTTP 503 service unavailable
  …
plot-host: pr-list: answered 1 of 3 states; missing: merged, declined
```

Exit **7**, the answering state's row on stdout, the failures named on stderr. That is precisely slice 2's Done-when, on unmodified main. A reduced stub isolating only the substitution gave the same result: the collector reported `ok=1 failed=2 first_rc=3` after two `exit 3` calls had already run inside subshells.

## 3. Slice 2's Done-when is already a passing test

The Done-when asks for:

> pinned by a test that a `die` path reached mid-loop still yields 7 when an earlier state answered; a failure with **no** state answered still exits with the kind it has today, pinned per kind

Both exist, in `test/reconcile/host.test.mjs:1038` and `:1081`, under the banner `── A PARTIAL ANSWER IS NOT AN OUTAGE (#912) ──` at `:1018`. The second is pinned **per kind** — 5, 6 and 3 — exactly as asked. I ran them:

```
✔ host: pr-list keeps the states that answered when one fails, and exits partial (5221ms)
✔ host: a single-state pr-list that fails is a failure, never a partial answer (1498ms)
✔ host: every state answering still exits 0, with no partial verdict (3143ms)
✔ host: the GitHub arm makes ONE call and cannot answer partially (1234ms)
ℹ pass 5  ℹ fail 0
```

The plan's own instruction — *"Is there an existing test covering the partial path? If the behaviour is already pinned, the plan should say so"* — is answered: it is pinned, and the plan does not say so.

## 4. The die count is real but irrelevant to the path

The count is accurate: 17 `die` + 3 `die3` = 20 call sites. But a count of all dies in a 4153-line file is not evidence about the pr-list path. Auditing every site by line number:

- **13 are `*) die "<op>: unknown arg $1"`** — argument parsers, before any host call.
- **2 are missing-required-argument** (`:2928` pr-create needs `--title`, `:3889` pr-body needs `--body`).
- **2 are usage/unknown-op** (`:2579`, `:4151`).
- **`:1870`** is the Jira tracker base URL, a different op entirely.
- **`:4043`** is `die3` in the `limit` op.
- **`:1438`** is `bb_states_for`'s unknown-state die.
- **`:1671`** is `bb_require_json`'s die3.

**Zero die sites are inside the `pr_list_states` loop.** The two that touch the bitbucket pr-list arm at all — `bb_require_json` (`:3209`) and `bb_states_for` (`:3215`) — both run **before** the loop, and that ordering is deliberate and commented at `:3210-3214`:

```
# Resolve the states BEFORE the loop. `for s in $(bb_states_for …)` runs
# the helper in a subshell, where `die` exits that subshell only: the
# loop would then iterate an empty list and the command would succeed
# with no output — an unknown state reading as "no PRs matched"
```

Both also fire before any row is printed, so neither can produce the plan's stated harm ("rows already printed go out with a code that says total refusal"). `bb_states_for` additionally has `|| exit 1` at its call site precisely to defeat the subshell swallow.

## 5. What that does to the scoping question

The plan asks whether scoping to pr-list is coherent, or whether the fix must generalise. Neither: **there is nothing to scope.** The Done-when's own justification for leaving the other 19 alone — *"each ends an operation that printed nothing"* — is correct, and it is equally true of the pr-list path's two, which is why they were hoisted above the loop rather than converted to returns. The 19/1 split the plan draws does not exist; it is 20/0.

## 6. What I am not claiming

I am **not** claiming the reported bug is imaginary. Seven PRs reading *no PR ever opened* on a live board is a measurement and slice 1's diagnosis of it — `refusalKindOfExit(7)` returning `'failed'` in `host-shell.ts` where `hostSaid` returns `partial` in `scripts-shell.ts` — is consistent with everything I read on the shell side. The shell emits 7 correctly and keeps the rows; if the port then discards them, the defect is entirely in the port. That makes slice 1 the whole fix and slice 2 a second fix for a defect that is not there.

I am also not claiming the plan's Notes are wrong. The Notes concede the trigger is unmeasured:

> **One trigger is still unmeasured**: what makes the port's `prList` call fail on this repository at all.

That is the honest gap, and slice 2 does not close it — `prList(state, limit)` asks **one state**, and a single-state call cannot answer partially by construction (`plot-host.sh:583-586`, pinned at `host.test.mjs:1105`). So whatever the port's call is hitting, the pr-list loop's partial classification is not on its path. Slice 2 would not have fixed the measured board.

## 7. The amendment

Delete slice 2. Keep slice 1 as the plan's whole content. If the author wants the unmeasured trigger chased, that is a new slice with a measurement in front of it, not a rewrite of a loop that already behaves as specified.

If slice 2 is kept in any form, the Design section must at minimum be corrected: "An `exit` ends the script, so the collector never runs" is false as written and contradicts three comment blocks in the file it describes.

## Method note

Findings 1-4 are measurements: a reduced stub isolating the substitution, the real adapter under a PATH-stubbed `bb`, a full line-by-line audit of all 20 die sites, and a live run of the existing test suite. Read-only throughout; no repository file was modified.
