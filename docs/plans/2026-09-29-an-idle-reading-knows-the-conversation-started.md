# An idle reading knows the conversation started

> The idle verdict reads the desk's newest transcript mtime, which on a reused desk is the PREVIOUS session's. A new conversation that writes nothing for 900 s is ended as idle on a silence it did not produce.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1074
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The idle verdict no longer fires on a conversation that has not written yet: a desk whose newest transcript predates the current worker's start reads as `unstarted`, not as silence.

Board impact: none. This is the worker monitor's verdict, which the board renders but does not compute.

## Motivation

`plot-transcript-quiet.sh:105-106` takes the newest mtime across every non-`agent-` `*.jsonl` in the desk's project directory:

```sh
if [ -z "$newest" ] || [ "$mtime" -gt "$newest" ] 2>/dev/null; then newest="$mtime"; fi
done < <(find "$dir" -maxdepth 1 -type f -name '*.jsonl' -print0 2>/dev/null)
```

No session id enters that loop, and its header says so deliberately (`:27-35`): the question is *is anything happening at this desk*, and an operator typing at the same worktree is a true answer to it.

**That join is right for its own question and wrong for the one `idle` asks.** `plot-worker-monitor.sh:545-551` fires `idle` when four conditions hold together: this pass quiet, the previous pass quiet, the tree unchanged, and `monitor_has_commits` yes. Every one of those reads the DESK. None asks whether the current worker's conversation ever started.

So a worker whose first prompt is slow inherits the previous session's last write as its own activity clock. If that write was more than `PLOT_MONITOR_QUIET_SECONDS` (900 s) ago — which on a reused desk it usually is — the worker is quiet from its first pass, quiet again on its second, and ended on a silence produced by a session that already finished.

### The commit condition should have refused, and the ticket could not establish why it did not

#1074 records the ewz-leg finding as *"the branch already carries commits"* and says it cannot be established whether the reset fell through.

**It can be established, and the answer narrows this plan.** `monitor_has_commits` counts with a pathspec:

```sh
n=$(git -C "$worktree" rev-list --count "$base..HEAD" -- . 2>/dev/null) || return 2
```

The `-- .` keeps only commits that TOUCHED A FILE, and `plot-dispatch.sh:2074` writes the claim as `commit --allow-empty`. That pathspec was added for #538, where a claim commit satisfied the guard that was meant to refuse. So on a correctly reset desk — `reset_desk` detaching to `origin/<main>` at `plot-worker-loop.sh:928` before cutting the new branch — `has_commits` returns 1 and `idle` cannot fire.

**Two readings survive, and they need different fixes:**

1. The reset fell through and the desk kept the previous slice's commits. Then the defect is in `reset_desk`, not here.
2. The branch carried pushed work from an earlier attempt — a `--restart`, or a slice resumed after a stop. Then `has_commits` is correctly yes and the quiet join is the whole defect.

**This plan fixes (2) and MEASURES (1) rather than assuming it away.** The first slice reproduces the ewz-leg shape in a sandbox and reports which reading it is; the fix does not depend on the answer, because the join is wrong in both.

### Why #1067 does not remove it

#1067 (`bug/a-slice-starts-its-own-conversation`, PR #1077) makes a hop to a new branch start a fresh conversation with `--session-id`. That removes the measured *cause* of the 2 770 s silence — the first prompt no longer reloads the previous slice's transcript.

**It changes nothing this rule reads.** A fresh conversation still writes nothing until it loads, and the reader still takes the directory's newest file. #1067 makes the defect rarer and leaves it reachable by any slow start: a cold model, a long `--resume`, a machine under load. **A defect that is only reachable under load is the one that fires when the fleet is busiest.**

## Design

### The rule

**An idle verdict requires evidence that THIS worker's conversation produced output.** A desk whose newest transcript is older than the worker's own start has not been silent — it has not spoken yet, and those are different facts.

### The word is `unstarted`, and it is not a fifth finding

`plot-transcript-quiet.sh` already answers `unavailable` as a WORD rather than a number, for the reason its header gives: a caller reading an absent capability as *quiet for 0 seconds* would report every unreadable agent healthy.

**This needs the same treatment and the same shape.** A desk whose every transcript predates the worker's start answers `unstarted`. It is not `0` (which claims output just happened) and not `unavailable` (which claims the reading could not be made — it was made, and it says the conversation has not begun).

`plot-worker-monitor.sh` matches on the word and publishes NOTHING: `busy` and `unknown` are already non-findings there, and this joins them. **No new finding is added** — an unstarted worker is not a state an operator acts on, it is the absence of grounds for the one finding this plan constrains.

### The instrument is the MANIFEST's mtime, not the pid file's

**Round 1 refuted the plan's original instrument by measurement.** It proposed `.plot-worker.pid`'s mtime as *when this worker started*. It is when the **wrapper loop** launched, and the loop never rewrites it across a hop.

Measured 2026-09-29 on this machine's live, working desks:

| desk | pid file age | transcripts older than it |
|---|---|---|
| `free-c7b58b4f` | **8h 00m** | 0 of 9 |
| `free-dfdc5491` | **3h 29m** | 0 of 4 |
| `free-02487045` | 2h 48m | 0 of 4 |

**0 of 17 transcripts predate their pid file**, so the proposed rule fires on none of them — including the reused-desk case the Motivation is written about, where the pid file is hours older than every transcript by construction. The fix as first drafted is inert on 100% of this estate.

**`update_manifest_on_hop` rewrites the manifest on every hop**, so its mtime moves with the slice where the pid file's does not — measured +10108 s, +6257 s and +3704 s ahead of the pid file on the three live desks. It also bumps `wavesCount`, and all three desks here have hopped (5, 4 and 3 waves).

**So the reading is: the newest transcript against the MANIFEST's mtime.** Same instrument class the quiet reader already defends at `:87-91` — comparing two mtimes the machine keeps — applied to the file that actually marks this slice's start.

**The operator-at-the-desk case still holds**, and it was measured: an operator typing after the slice started writes a newer mtime and reads as activity, whoever's session wrote it. The comparison is against a time, never a session id, which is what preserves the quiet reader's own argument. An operator who typed *before* the slice started now reads as `unstarted` — that is a real narrowing and it is stated rather than implied.

### This plan DEPENDS on #1067, and that is a reversal

The plan first argued #1067 only reduces the defect's frequency. **Measured, it is a precondition.**

Today `.plot/worker-prompt.sh:19-21` passes `--session-id` on the first prompt and `--resume` after, and all three live manifests confirm `resumeId == session`. So a hop writes into the **same** `.jsonl` the previous slice wrote: one file, one mtime, and no second file that could be older. **`unstarted` is unreachable on a hop as `main` stands.**

#1067 (PR #1077, merged) makes each slice mint its own conversation, so the directory holds a file per slice and the state becomes reachable. **This plan must land after it**, and the earlier "it changes nothing this rule reads" — true of the quiet reader's code — was the wrong question.

### What this does NOT do

- **It does not change `plot-transcript-quiet.sh`'s question.** The reader still answers about the desk. It gains one more word for one more true state of the desk.
- **It does not add a grace period.** A fixed start-up window is a timer where a measurement is available, and it would be wrong in both directions: too short for a loaded machine, too long for a worker that really did stall after speaking once.
- **It does not touch `monitor_has_commits`.** If the sandbox finds reading (1), that is a separate finding against `reset_desk` and it is filed, not folded in.
- **It does not change `gone`.** A dead pid is unaffected by whether its conversation started.

## Done when

- **A desk whose newest transcript predates its MANIFEST's mtime answers `unstarted`**, asserted against a sandbox built with `touch -t`. Not the pid file: measured, 0 of 17 live transcripts predate their pid file, so a rule keyed on it fires on nothing.
- **A desk whose newest transcript is NEWER than the manifest still answers a number**, including when that transcript belongs to another session — the operator-at-the-desk case, asserted explicitly.
- **The hop case is asserted**: a desk carrying a previous slice's transcript and a freshly rewritten manifest answers `unstarted`. This is the shape #1074 was filed from, and the plan's first instrument missed it.
- **`plot-worker-monitor.sh` publishes no finding on `unstarted`**, asserted across two consecutive passes with an unchanged tree and commits present — the four-condition conjunction that fires today.
- **A desk with no manifest answers as it does today.** An unreadable start time is not evidence the conversation has not begun.
- **The ewz-leg reading is named.** Round 1 refuted one of the two: a correctly reset desk returns `has_commits rc=1` and `idle` cannot fire, measured. So the desk either carried pushed work from an earlier attempt, or the reset fell through — the slice says which and files the other.
- **Both copies of the script are changed**: `skills/plot/scripts/plot-worker-monitor.sh` and `packages/board/plot-worker-monitor.sh`, byte-identical today and shipped through the board's `files` list. The slice says how they stay in sync.
- `node --test test/reconcile/workermonitor.test.mjs` stays green — **note the path has no hyphen**; it runs 36 tests today.

## Slices

### An idle reading knows the conversation started (Branch: bug/an-idle-reading-knows-the-conversation-started)

Add the `unstarted` word, match it in the monitor, and reproduce the ewz-leg shape.

## Notes

**The two joins are now three questions, and the header should say so.** `plot-transcript-quiet.sh:36-41` already contrasts *is anything happening at this desk* (per worktree) with *what has THIS agent spent* (per session). This plan adds a third: *has this worker's conversation started* — per worktree, and per worker's start time. It is neither of the first two, and a reader of that header should not have to derive it.

### Round 1, 2026-09-29

Two jurors, both **amend**, both **executed**. Verdicts: `.plot/panels/2026-09-29-an-idle-reading-knows-the-conversation-started/`.

**Both refuted the plan's instrument independently.** `.plot-worker.pid`'s mtime is the wrapper's launch and is never rewritten on a hop; 0 of 17 live transcripts predate their pid file, so the rule was inert on every desk on this machine — including the reused-desk case the plan was written about. One juror drove the full hop shape through two monitor passes and watched `idle` publish anyway.

**The design is rebuilt on the manifest's mtime**, which `update_manifest_on_hop` rewrites per slice, measured hours ahead of the pid file on all three live desks.

**The relationship to #1067 is reversed from what the plan claimed.** Today a hop `--resume`s one session id into one file, so there is no second file to be older and `unstarted` is unreachable. #1067 mints a fresh conversation per slice and makes the state reachable — it is a precondition, not a frequency reduction.

Also folded in: the ewz-leg commit reading is half-settled by measurement (a correctly reset desk refuses `idle`); the script has two byte-identical copies and the plan named one; and the test file is `workermonitor.test.mjs`, without the hyphen.
