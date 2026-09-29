Position: amend
Evidence: executed

## What I ran and what it showed

I built a sandbox desk (upstream repo + clone + branch + fake `.plot-worker.pid` + a `$HOME/.claude/projects/<slug>` holding a `touch -t`-aged `*.jsonl`) and drove `monitor_pass` twice with `PLOT_MONITOR_NO_MAIN=1`, redefining `monitor_activity` to return "" (no child on a core).

### The defect IS real. Reproduced end to end.

**Case A — correctly reset desk, only the `--allow-empty` claim commit:**

```
===== CASE A: reset desk, ONLY the --allow-empty claim commit =====
quiet reading:   2806s
has_commits rc:  1  (0=yes 1=no 2=unanswerable)
verdict:         quiet
after pass1:     published=''
after pass2:     published=''
--- findings file ---
(none)
```

**Case B — same desk, one file-touching commit added (the ewz-leg shape):**

```
===== CASE B: same desk + ONE file-touching commit =====
quiet reading:   2836s
has_commits rc:  0
verdict:         quiet
after pass1:     published=''
after pass2:     published='idle'
--- findings file ---
{"monitor":"WorkerMonitor","branch":"bug/slice-two",...,"finding":"idle",
 "evidence":"the agent pid 50741 is alive but its transcript has been silent for over 900s
 with no child process burning CPU behind it, across two consecutive passes ~30s apart,
 the tree is unchanged between them, and the branch already carries commits",...}
```

So: the four-condition conjunction fires exactly as the plan describes, on a live pid, against a transcript that belongs to a session that is not the current one. **The plan's premise holds and its `monitor_has_commits` reading is correct** — `-- .` does make a correctly-reset desk return 1, and `idle` cannot fire there.

### Slug derivation — verified

```
plot_transcript_slug "/private/tmp/.../j1074/desk"
  → -private-tmp-claude-501--Users-jwloka-Quatico-Agentic-Tools-plot-...-j1074-desk
```

against real directories:

```
-Users-jwloka-Quatico-Agentic-Tools-plot--worktrees-bug-a-monitor-ends-with-its-agent
```

Matches. One nit: the plan says "the WORKTREE PATH with `/` replaced" — `tr '/.' '--'` replaces `/` **and** `.`. Immaterial to the fix; the script's own header states both.

### `.plot-worker.pid` — written ONCE, by the wrapper, and never again

`plot-dispatch.sh:1457`, inside the detached `sh -c`:

```sh
( '"$cmd"' ) & agent=$!; printf "%s" "$agent" > "$PLOT_PID_FILE";
```

```
$ grep -n 'PLOT_PID_FILE\|pid_file' skills/plot/scripts/plot-worker-loop.sh
(none — the loop never touches it)
```

The loop hops branches inside that one wrapper. `plot-worker-loop.sh:2226`:

```sh
if ! desk_refusal=$(desk_reset_refusal "$PLOT_WORKTREE"); then
    hop_wt="$PLOT_WORKTREE"          # ← the SAME desk, the default path
    if ! reset_desk "$hop_wt" "$next_branch"; then
```

and the loop's own comment at `:947`: *"A worker HOPS: the loop below asks `--next` for another branch of the same plan while `session` and `pid` stay fixed."*

## What a measurement contradicts

### 1. FALSE CENTRAL CLAIM — the proposed fix does not fire in the case the plan was written for

The plan's rule is: *newest transcript older than `.plot-worker.pid`'s mtime → `unstarted`*. The plan's own Motivation says the defect bites on **a reused desk** (":33 — which on a reused desk it usually is"). But on a reused desk the pid file is the WRAPPER's launch, hours before the hop, and every transcript on that desk is NEWER than it.

I modelled that exactly — wrapper 3 h old, previous slice's transcript 47 min old, new slice just started:

```
pid mtime     : 1790693460
slice-1 mtime : 1790701440
quiet reading : 2829s

PROPOSED RULE: newest(1790701440) < pid(1790693460)?  -> NUMBER -> idle STILL FIRES
```

and drove two passes:

```
===== HOP SHAPE, pid file 3h old, slice-1 transcript 47min old =====
quiet: 2842s
has_commits rc: 0
FINAL published: 'idle'
```

**`idle` still publishes.** The fix is inert on the very shape the plan's Motivation describes.

### 2. The rule is inert on 100% of this machine's live desks — 0 of 17 transcripts

```
=== Would the PROPOSED rule fire? ===
free-02487045   number (rule does NOT fire)
free-c7b58b4f   number (rule does NOT fire)
free-dfdc5491   number (rule does NOT fire)

=== transcripts predating the pid file ===
free-02487045   older-than-pid=0 newer-than-pid=4
free-c7b58b4f   older-than-pid=0 newer-than-pid=9
free-dfdc5491   older-than-pid=0 newer-than-pid=4
```

Every live desk's pid file is 1.1–2.8 h older than its newest transcript:

```
free-02487045  pid=1790693497 newest=1790703603 delta=+10106
free-c7b58b4f  pid=1790677210 newest=1790681064 delta= +3854
free-dfdc5491  pid=1790693497 newest=1790703586 delta=+10089
```

### 3. Desk reuse is the NORMAL case here, not an edge

```
=== desks holding >1 non-agent transcript ===
free-02487045  4 transcripts
free-c7b58b4f  9 transcripts
free-dfdc5491  4 transcripts
--- 3 of 3 desks hold >1 conversation ---

=== manifests with wavesCount > 1 (agents that HOPPED) ===
2c84bba2... wavesCount=5
a9bc4536... wavesCount=4
fc4f1048... wavesCount=3
```

Three for three. The plan's rule works only on the first slice of a freshly-cut desk, which is the population that also has no previous session to be confused by — i.e. the case that was never broken.

### 4. Today a hop `--resume`s the SAME session id, so there is no second file to be older

`.plot/worker-prompt.sh:19-21`: *"`--session-id` on an agent's first prompt and `--resume` on every one after. The loop decides which by probing whether a transcript already exists under that id."* Live manifests confirm `resumeId == session` on all three agents. So on today's `main`, a hop writes into the **same** `.jsonl` the previous slice wrote — the newest file is the current conversation's file, carrying the previous slice's last write. An mtime comparison cannot separate those, because there is only one file and one mtime. The plan's `unstarted` state is not reachable on a hop as the code stands.

### 5. A better signal exists on the desk and the plan never measured it

`update_manifest_on_hop` (`plot-worker-loop.sh`) rewrites the manifest on every hop:

```js
manifest.branch = argv[2]; manifest.worktree = argv[3];
if (argv[5] !== "") manifest.resumeId = argv[5];
manifest.wavesCount = (manifest.wavesCount || 1) + 1;
```

so the manifest's mtime moves with the slice where the pid file's does not:

```
free-02487045  manifest-pid=+10108  newest-manifest=   -2
free-dfdc5491  manifest-pid= +6257  newest-manifest=+4433
free-c7b58b4f  manifest-pid= +3704  newest-manifest= +150
```

And #1067/#1077 introduces `resumeId` as *the current slice's conversation id*, re-minted on a hop — the exact per-slice identity the plan says does not exist. The plan's §"The worker's start is a fact the desk already holds" asserts the pid file is that fact; it is the WRAPPER's start, which is a different fact.

### 6. The plan's read of #1067 is CORRECT — this one survives

```
$ gh pr view 1077 --json files -q '.files[].path' | grep -E 'transcript-quiet|worker-monitor'
NO — neither file is in the PR
```

#1077 changes `registry.ts`'s transcript join to `entry.resumeId || entry.session`. It does not touch `plot-transcript-quiet.sh`, which still `find`s the newest file in the directory. The plan's "It changes nothing this rule reads" is accurate. **But** #1077 makes a hop mint a NEW session id, which means after it merges the directory WILL hold a fresh file per slice — which changes the reachable shapes this plan is reasoning about, and the plan treats #1077 only as frequency reduction.

### 7. Two factual errors in "Done when"

- `test/reconcile/worker-monitor.test.mjs` **does not exist**. The file is `test/reconcile/workermonitor.test.mjs` (no hyphen). It runs green today: `tests 36, pass 36, fail 0`.
- `packages/board/plot-worker-monitor.sh` is a **byte-identical copy** of the script (`diff -q` → IDENTICAL), shipped via `packages/board/package.json`'s `files` list. The plan names one file to change and there are two.

## What it must say before someone builds it

1. **Name the signal that actually moves per slice, and prove it.** `.plot-worker.pid`'s mtime is the WRAPPER's launch and is never rewritten — quote `plot-dispatch.sh:1457` and the grep showing `plot-worker-loop.sh` never writes it. Then choose between the manifest's mtime (measured +10108 s / +6257 s / +3704 s ahead of the pid file on the three live desks) and `resumeId`'s own transcript, and say why.

2. **State the plan's relationship to #1077 as a dependency, not a frequency argument.** Today a hop `--resume`s one id into one file, so `unstarted` is unreachable on a hop. After #1077 each slice gets its own file. If this plan is meant to fix the hop case it must either land after #1077 or say explicitly that it fixes only the first slice of a fresh desk.

3. **Re-scope the "Done when" bullets to a case that can hold.** As written, bullet 1 ("newest transcript predates `.plot-worker.pid`'s mtime") is assertable only in a fixture, never on this estate — 0 of 17 live transcripts satisfy it. Say which real population the fix serves and how many desks that is.

4. **Answer the ewz-leg reading, with the measurement I ran.** Reading (1) is refuted: a correctly reset desk returns `has_commits rc=1` and `idle` cannot fire (Case A output above). So the ewz-leg desk was reading (2) — the branch carried pushed work — OR the reset fell through. Since the plan's own bullet forbids "cannot be established", the plan must say which and file the other.

5. **Name both copies of the script.** `skills/plot/scripts/plot-worker-monitor.sh` and `packages/board/plot-worker-monitor.sh`, and say how they stay in sync.

6. **Fix the test path**: `test/reconcile/workermonitor.test.mjs`, 36 tests green today.

7. **Re-open the grace period the plan rejected.** #1074 names it as one of the two options. The plan rejects it as "a timer where a measurement is available" — but the measurement it proposes is not available (§1, §2). If no per-slice start signal is adopted, a bounded window after a hop is the only remaining option and the rejection has to be re-argued against the measurement rather than against the principle.

## What executing revealed that reading would not

Reading the plan, the pid file sounds like the right instrument — the argument in §"The worker's start is a fact the desk already holds" is well made and internally consistent. What only running showed is that **the file whose name says "this worker began here" is written by the wrapper, and the wrapper outlives the slice by hours**. That does not appear anywhere in `plot-worker-monitor.sh`'s own prose; it took `grep 'PLOT_PID_FILE' plot-worker-loop.sh` returning nothing plus reading `plot-dispatch.sh:1457`'s `sh -c` to establish, and then a three-desk `stat` sweep to see that the gap is 1–3 hours in practice rather than seconds.

Equally, only executing separated Case A from Case B cleanly. The plan asserts `-- .` makes a reset desk safe; that is true, and I would not have believed it from the source alone, because `reset_desk`'s `checkout -b` path and the claim commit's `--allow-empty` are three files apart. Running it turned the plan's most contested paragraph into a confirmed one — which is worth as much as the refutation, since it is what narrows the remaining defect to reading (2).

The `wavesCount=5/4/3` sweep is the finding I would have missed entirely by reading: it turns "a reused desk" from a hypothetical into the only shape this machine currently runs, and that is what makes the proposed rule inert rather than merely incomplete.
