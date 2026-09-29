# An idle reading knows the conversation started

> The idle verdict reads the desk's newest transcript mtime, which on a reused desk is the PREVIOUS session's. A new conversation that writes nothing for 900 s is ended as idle on a silence it did not produce.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1074
- **Review:** in-session
- **Impl:** own branches

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

### The worker's start is a fact the desk already holds

The monitor does not need a new record. `.plot-worker.pid` is written at launch, and its own mtime is when this worker started — the same instrument the quiet reader already uses on transcripts, applied to a file whose meaning is exactly *this worker began here*.

**This is not a new clock.** The header at `:87-91` defends mtime for precisely this question: *how long since output?* is a question about elapsed time. *Did output happen after the worker started?* is the same kind of question, comparing two mtimes the machine already keeps.

**What this does NOT do is join on the session id.** The header's argument stands — an operator's own session at the desk is a true answer to *is anything happening here* — and this keeps that. The comparison is against a TIME, so an operator typing at the desk still produces a newer mtime and still reads as activity, whoever's session wrote it.

### What this does NOT do

- **It does not change `plot-transcript-quiet.sh`'s question.** The reader still answers about the desk. It gains one more word for one more true state of the desk.
- **It does not add a grace period.** A fixed start-up window is a timer where a measurement is available, and it would be wrong in both directions: too short for a loaded machine, too long for a worker that really did stall after speaking once.
- **It does not touch `monitor_has_commits`.** If the sandbox finds reading (1), that is a separate finding against `reset_desk` and it is filed, not folded in.
- **It does not change `gone`.** A dead pid is unaffected by whether its conversation started.

## Done when

- A desk whose newest transcript predates `.plot-worker.pid`'s mtime answers `unstarted`, asserted against a sandbox directory built with `touch -t`.
- A desk whose newest transcript is NEWER than the pid file still answers a number, including when that transcript belongs to another session — the operator-at-the-desk case the header protects, asserted explicitly.
- `plot-worker-monitor.sh` publishes no finding on `unstarted`, and in particular does not publish `idle`, asserted across two consecutive passes with an unchanged tree and commits present — the exact four-condition conjunction that fires today.
- A desk with no pid file answers as it does today. **The reading degrades to the current behaviour rather than to `unstarted`**: an unreadable start time is not evidence that the conversation has not begun, and defaulting to `unstarted` would silently disable `idle` wherever the pid file is missing.
- **The ewz-leg shape is reproduced in a sandbox and the reading is named** — reset fall-through, or a branch carrying pushed work. If it is the former, it is filed as its own issue and referenced here. **Answering "cannot be established" does not satisfy this bullet**; the ticket already says that, and repeating it ships the fix without knowing whether a second defect sits behind it.
- `node --test test/reconcile/worker-monitor.test.mjs` stays green, and any assertion that changes is named rather than renumbered.

## Slices

### An idle reading knows the conversation started (Branch: bug/an-idle-reading-knows-the-conversation-started)

Add the `unstarted` word, match it in the monitor, and reproduce the ewz-leg shape.

## Notes

**The two joins are now three questions, and the header should say so.** `plot-transcript-quiet.sh:36-41` already contrasts *is anything happening at this desk* (per worktree) with *what has THIS agent spent* (per session). This plan adds a third: *has this worker's conversation started* — per worktree, and per worker's start time. It is neither of the first two, and a reader of that header should not have to derive it.
