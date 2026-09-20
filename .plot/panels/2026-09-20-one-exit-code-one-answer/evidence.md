# Juror: the evidence

Position: amend

Lens: re-take the measurements. The plan's two source claims survive. Its central
*diagnosis* does not: the symptom on the live board is fully explained by a
**three-day-stale board process** running code that predates the plan's own
prior fix, and the plan's decisive reading (`code=1 out=3` on `hostSaid`) is an
artifact of that staleness rather than evidence of an untaught port.

## What I verified and what held

### Claim 1 — "exit 7 means partial to `hostSaid` and failed to the port" — HOLDS

`packages/domain/src/adapters/scripts/scripts-shell.ts:100`

```ts
      if (run.code === 7) return { answer: 'partial', stdout: run.stdout, said };
      return run.code === 4 ? { answer: 'unaskable', said } : { answer: 'failed', said };
```

`packages/domain/src/adapters/host/host-shell.ts:148-151`

```ts
export const refusalKindOfExit = (code: number): HostRefusal['kind'] => {
  if (code === EXIT_QUOTA) return 'throttled';
  if (code === EXIT_SECONDARY) return 'secondary';
  return 'failed';
};
```

`EXIT_QUOTA = 5` (:128), `EXIT_SECONDARY = 6` (:131). Seven falls to `'failed'`.
`ports/host.ts:207` declares `prList(state, limit?): Promise<PortResult<readonly Pr[]>>`
and the file contains no `partial`. **The asymmetry the plan names is real.**

### Claim 2 — "the board has TWO pr-list call sites and they are different calls" — HOLDS

In the shipped bundle, two hits. The port's:

```js
prList:(d,p)=>i(["pr-list","--state",d,...p===void 0?[]:["--limit",String(p)]],...)
```

and `hostSaid`'s:

```js
K(e).hostSaid(["pr-list","--rich","--state","all","--limit",String(eE)])
```

One asks all states with `--rich`; one asks a single state. Confirmed.

### Claim 3 — "Three PRs open on the host" (#358, #405, #445) — HOLDS EXACTLY

```
count: 3
#405 feature/ki-lp-conversion-events | Draft: KI-LP Conversion-Events
#445 idea/hubspot-secret-hydration   | Plan: VITE_HUBSPOT_IDENTIFY_PAYLOAD_SECRET
#358 improvement/QUACDS-958-standardize-ports | I: QUACDS-958 standardize
```

The same three numbers and the same three branches. All three appear among the
board's seven rows, and all seven read `pr: null` with note
`commits, no PR ever opened`. **The symptom reproduces in full.**

### Claim 4 — "`prAgeSeconds` is null" — HOLDS, and it is the thread that unravels the rest

Three polls, 90 s apart:

```
2026-09-20T12:26:05.686Z age: null next: 339 errLines: 2 prNull: 7/7
2026-09-20T12:26:52.409Z age: null next: 294 errLines: 2 prNull: 7/7
2026-09-20T12:27:38.821Z age: null next: 247 errLines: 2 prNull: 7/7
```

Still null. Seven of seven rows show no PR.

## The refutation: the plan's diagnosis is contradicted by its own board

### The board cannot reach exit 7 at all, because the calls exit 0

I ran both call sites by hand against the live repo, with the board's own
shipped `plot-host.sh`:

```
$ bash plot-host.sh pr-list --rich --state all --limit 1000
EXIT=0
stdout lines: 66
```

```
$ bash plot-host.sh pr-list --state open --limit 1000
EXIT=0
stdout lines: 3
```

**Both exit 0.** Not 7. And all 66 lines are valid JSON:

```
total non-empty lines: 66 unparseable: 0
```

So on today's shell there is no partial, no exit 7, and nothing for the untaught
port to mis-map. The stderr lines are **truncation warnings**, not failures:

```
plot-host: bitbucket ignores --limit 1000; bb returns a fixed page (50 at 1.0.0)
plot-host: bitbucket pr-list state=open possibly truncated (3 rows, ...) (#333)
```

### The board's `prError` is byte-identical to the *open*-state call's stderr

The board reports exactly two lines:

```
plot-host: bitbucket ignores --limit 1000; bb returns a fixed page (50 at 1.0.0)
plot-host: bitbucket pr-list state=open possibly truncated (3 rows, requested limit 1000 unprovable) — ... (#333)
```

The `--state all` call emits **four** such lines (open, merged, declined). The
board holds only the two from `--state open`. That is the port's `prList(open)`
stderr verbatim — consistent with the plan's account of which path throws.

### But the running board is three days stale, and that explains everything

```
  PID  STARTED                       ELAPSED
47253  Thu Sep 17 07:08:40 2026      03-07:20:44
```

Against the artifacts it is supposed to be running:

| artifact | written |
|---|---|
| board process start | **2026-09-17 07:08** |
| `#951` merged (`988dac2cb`, "The arm reports the states that answered") | 2026-09-18 16:21 |
| shipped `plot-host.sh` | 2026-09-18 17:08 |
| shipped `board-server.mjs` | 2026-09-20 13:51 |

**The process predates every one of them.** And it has no supervisor:

```
  PID  PPID     ELAPSED
47253     1 03-07:20:49
```

`ppid 1` — an orphan. `node --watch` is not over it (the `--watch` pair at
80729/51688 is a *different* board, this repo's own). CLAUDE.md's note that
`pnpm board` runs under `node --watch` so a rebuild takes effect does **not**
apply to this process. It loaded its code on Sep 17 and never reloaded.

### What that older code does with exit 7 — the actual cause

At `988dac2cb^` (the commit before #951), `hostSaid` was:

```ts
      if (run.code === 0) return { answer: 'answered', stdout: run.stdout };
      return run.code === 4 ? { answer: 'unaskable', said } : { answer: 'failed', said };
```

No `code === 7` arm — exit 7 became `'failed'`. And `refreshPrs` was:

```ts
    if (said.answer !== 'answered') throw new Error(said.said);
```

No `&& said.answer !== 'partial'`. So a partial threw, the catch set
`entry.prError = message`, `entry.prAt` was never assigned, and `prAgeSeconds`
stayed null with every row falling back to no-PR. **That is precisely the
observed state, produced entirely by stale code — with no untaught port
required.**

This also explains the plan's decisive reading. `code=1 out=3` is what a
**pre-#951** `hostSaid` reports. The plan reads that as proof the port's path
never reaches `hostSaid`; it is equally, and more simply, the old bundle's
`hostSaid` on a call that today exits 0.

### One refutation I made and then withdrew — recorded because the panel should see it

I first concluded `refreshRuns` threw before `entry.prAt = Date.now()`
(`fleet.ts:2572-2573`), on `throw new Error('runs unavailable')` at :2152.
**That is wrong and I withdraw it**: the throw sits inside a per-branch
`try`/`catch` (:2165) that swallows it, so `refreshRuns` cannot abort the pass.
I also checked the seven branches' `runs` calls and all seven answer `rc=0`
under `CI: jenkins`. Recorded so nobody re-walks it.

## Spot-checks of the refuted list — all three I took hold

**The empty shim dir.** The board's PATH does begin with a cmux shim directory:

```
PATH=/var/folders/.../cmux-cli-shims/B127B5BE-29CC-4F4A-BAD6-7B0AFFC4F3D1:...
```

and it is empty, with no `bb`:

```
total 0
drwx------@  2 jwloka  staff    64 Sep 10 03:41 .
ls: .../bb: No such file or directory
```

**Refutation holds** — and the plan was right to check, since the dir really is
first on PATH.

**Version mismatch between bundle and shell.** Both carry the code-7 contract —
shell has `PR_LIST_PARTIAL_RC` 3 times (defined `=7` at :553, returned at :638),
bundle has `a.code===7?{answer:"partial",...}`. **The refutation holds for the
files on disk** — but it is the wrong pair. The mismatch that matters is
**bundle-on-disk vs bundle-in-memory**, and the plan never took that reading.
This is the one refuted hypothesis that was dismissed against the wrong subject.

**The missing `exit 7` grep.** Confirmed: the shell returns the variable
(`return "$PR_LIST_PARTIAL_RC"`, :638), never the literal. The plan's admission
that its own grep was wrong is accurate.

## Claims resting on nothing

- **"`plot-host.sh` carries 20 `die` calls (17 `die`, 3 `die3`)."** I measure
  **21** call sites total, of which `die3` is 3 — so 18 `die` and 3 `die3`. The
  plan's arithmetic (20 = 17+3) is also internally inconsistent with its slice 2
  text, which says "the other **19** `die` sites are untouched". Minor, but it is
  a counted claim and the count is wrong.
- **"The failure is silent in the log."** Not in the payload: `prError` is
  populated and non-null, and `AgentList.tsx:2175` and `host-notes.ts:370`
  render it. The plan's own Notes flag the log question as unanswered, which is
  honest — but "silent" overstates it.

## The unmeasured trigger — my view

The plan says: *"One trigger is still unmeasured: what makes the port's `prList`
call fail on this repository at all."* It is honest, and on my reading **it is
the load-bearing gap, not a footnote.** My measurements say the trigger is not a
property of the repository at all — it is the age of the process. The plan
argues the gap "does not change it, whatever the trigger"; but a trigger that
turns out to be *stale code already fixed by #951* means the live symptom is not
evidence for this plan, and the plan presents it as its opening measurement.

## Why amend and not reject

The **design defect is real and independently verified**: `hostSaid` and
`refusalKindOfExit` genuinely disagree about 7, `ports/host.ts` genuinely has no
`partial`, and one mapping read in two adapters is genuinely the shape that let
#951 teach one and not the other. Slice 1's "one definition both adapters read,
and a test that they agree for every code" is correct and worth building on its
own merits. Slice 2's `die`-bypasses-the-classifier argument is sound and I did
not refute it.

What must change is the **evidence base**, not the remedy:

1. **Restart the board on the current bundle and re-measure before approving.**
   If the seven rows resolve with no code change, the Design section's opening
   measurement is describing a stale process and must be rewritten. Nothing in
   the plan survives as *measured* until this is done.
2. **Re-take the `code=1 out=3` probe against a current board.** It was taken on
   a pre-#951 process; it cannot distinguish the plan's hypothesis from
   staleness.
3. **Correct the `die` count** (21 sites: 18 + 3) and reconcile "20" with "19".
4. **Soften "silent in the log"** — `prError` carries the sentence into the
   payload and the board renders it.
5. **Keep the refuted list but add the reading it missed**: bundle-on-disk
   versus bundle-in-memory, i.e. process age. That is the eighth hypothesis, it
   was never taken, and on my measurements it is the one that explains the
   symptom.

The plan's remedy may well be right. Its stated evidence for needing it, today,
is not.
