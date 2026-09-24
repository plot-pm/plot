# The probe asks Jenkins by its slug

> `plot-board-probe.sh` hands the whole `Jenkins instance` value to `jen -I`, so a correctly authenticating instance reports `auth: failed`. The script already carries a splitter that would produce the right slug — with four URL forms measured — and the auth call runs thirty lines above it.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #968
- **Rounds:** 1
- **Approved:** 2026-09-24, in-session review after panel (round 1)

## Changelog

- `/plot-board-setup` reports a healthy Jenkins as healthy. `plot-board-probe.sh:316` called `jen -I "$jen_instance"` with the full `<slug>/<job/path>` value where `jen` expects the slug alone, so an instance that authenticates correctly was reported `auth: failed` and adoption told the operator their credentials were wrong.

Board impact: none directly — the probe is adoption's reading. It decides what `/plot-board-setup` proposes, so a false `failed` blocks a correct configuration from being written.

## Motivation

**Adoption reports a working Jenkins as broken, and the operator's configuration is right.**

```
- **Jenkins instance:** ewz/kus-portal/continuous-build-multi
```

written exactly as `/plot-board-setup` prescribes, produces:

```json
"jen": {"installed": true, "auth": "failed",
        "instance": "ewz/kus-portal/continuous-build-multi",
        "job": "kus-portal/continuous-build-multi", "job_source": "instance"}
```

**`job` is parsed correctly from the same value.** One string, split for one field and passed whole to the call beside it.

The failure direction is the bad one. A probe that cannot tell reports `unknown` — the script says so at `:330`: *"Report that we cannot tell, never that it is fine."* This reports `failed`, which is a positive claim that the operator's credentials do not work.

## Design

### What was measured, 2026-09-24

`plot-board-probe.sh:316`:

```bash
out=$(jen -I "$jen_instance" auth status 2>&1); st=$?
```

`$jen_instance` is the raw config value (`:312`). The contract `plot-host.sh:1173-1174` states is `<slug>` **or** `<slug>/<job/path>`, so any repository that names a job path — which #913 established is required for PRs to resolve at all — hands `jen` a slug it does not have.

Reproduced by hand in the issue: `jen -I "ewz/kus-portal/continuous-build-multi" auth status` fails where the slug alone succeeds.

### The splitter already exists, and it is careful

Thirty lines below the failing call, `:366-392` computes exactly the slug that is needed, and its comment records why a naive split is not enough — all four forms measured:

```
jenkins.example.com                   → ''                                refuse ✓
jenkins.example.com/quaweb/cb         → 'quaweb/cb'                       accept ✓
https://jenkins.example.com/          → '/jenkins.example.com/'           ACCEPT ✗
https://jenkins.example.com/quaweb/cb → '/jenkins.example.com/quaweb/cb'  host glued on ✗
```

It strips the scheme and authority first (`_ji="${_ji#*://}"`), then splits at the first `/`.

**But it computes a JOB, not a SLUG** — a panel caught this, and it changes the fix's shape. `:376-394` produces `_ji` (scheme-stripped) and `_jen_job_raw` (everything after the first `/`). **Nothing there is the slug**, so "hoist the computation" as first written would move code that does not answer the question.

**The slug expression exists, in the other file.** `plot-host.sh:1228`:

```bash
slug="${instance%%/*}"
```

and every `jen -I` call there uses it (`:1250`, `:1268`, `:1321`).

**So the estate has the correct parse written down twice over, and the probe has neither half.** The fix is: hoist the scheme-strip so `_ji` is available early, add `${_ji%%/*}` as the slug, and pass that to `-I`.

### Why the ordering is the whole change

The job split sits **outside** the `jen_installed` block deliberately, and its comment says why: it is a string test on a config value, so it must answer on a machine that has the value and not the tool. Hoisting it above the auth block preserves that — the computation moves earlier, its scope does not narrow.

**The auth call then consumes the slug the same computation produced**, so the two answers cannot disagree about where one value's slug ends.

### What this does NOT do

- **It does not write a second splitter.** The existing one is measured against four forms and is the only one this file should have.
- **It does not change `classify` or the `OK` matching.** `:322`'s measured success word is correct and untouched — the value handed to `jen` is the defect, not the reading of its answer.
- **It does not make `auth` report `unknown` instead.** A real authentication failure must still say `failed`; the point is that this one is not real.
- **It does not touch `plot-host.sh`'s own `jen` calls.** Whether they split correctly is a separate reading, and the slice checks it rather than assuming either way.

### The Open Question is answered, and it NARROWS the slice

**`plot-host.sh` splits correctly.** `:1228` computes `slug="${instance%%/*}"` and all three `jen -I` calls use it — auth (`:1250`), job view (`:1268`), job list (`:1321`).

So the host adapter is right and **`plot-board-probe.sh:316` is the estate's only caller passing an unsplit value.** The slice does not widen, and the plan's argument strengthens: the correct expression is already written down, in the file whose contract comment the probe is failing to honour.

### Done when

- A `Jenkins instance` carrying a job path reports `auth: ok` where `jen -I <slug> auth status` succeeds.
- **A slug-only value still works** — the regression this must not cause, since it is the form that works today.
- A genuinely failing authentication still reports `failed`, and an unreachable one still reports what it reports.
- **One splitter in the file**, producing both the `job` field and the slug the auth call uses.

## Slices

### The probe splits once and uses it twice (Branch: bug/the-probe-splits-once)

- `bug/the-probe-splits-once` — hoist the scheme-strip above the `jen_installed` block, add the slug (`${_ji%%/*}`, the expression `plot-host.sh:1228` already uses) and pass it to `jen -I`; keep the computation outside the installed block so a machine with the value and not the tool still answers; the host adapter is verified correct and is not touched

## Notes

- Reported from an adopting repository (`ewz/kus-portal`), not reproducible here: this checkout declares no `Jenkins instance`, so `jen_instance` is empty and the auth branch takes the `unknown` arm that never calls `jen`. **The defect needs a configured Jenkins to appear at all**, which is why a repository that ships the Jenkins connector never saw it.
- The same shape as #969, filed the same day: a rule that exists and is correct, and a caller beside it that does not use it.
- **Panelled 2026-09-24: `unanimous amend`.** Three corrections accepted: the contract is at `plot-host.sh:1173-1174` and the plan cited `:702`; the existing splitter computes a job and **no slug**, so "hoist the computation" was the wrong description of the fix; and the Open Question is answerable from the code — `plot-host.sh` splits correctly, so this **narrows** rather than widens.
