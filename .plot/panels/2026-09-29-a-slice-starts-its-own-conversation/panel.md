# Panel — a slice starts its own conversation (#1067)

Subject: `docs/plans/2026-09-29-a-slice-starts-its-own-conversation.md`
Round 1, 2026-09-29. One juror, both commitments gated. One host call.

| Juror | Position | Evidence |
|---|---|---|
| consequence | amend | executed |

**The defect is real and the rule is right. Three load-bearing claims are false**, and the first is the cost the plan told an implementer to pay.

## THE COST IS INVERTED

The plan said the board *"will follow the newest slice and lose the previous one's history"*.

**The board follows neither.** It joins on `session`, not `resumeId` (`registry.ts:787-788`), and `session` is exactly what a hop does not write — `update_manifest_on_hop` sets `branch`, `worktree`, `resumeId`, `wavesCount`. Verified by the moderator at both sites, along with the docstring at `registry.ts:234-238`:

> **A SECOND FIELD, NOT AN ALIAS FOR `session`** … Nothing may assume the two agree.

The plan assumed it.

**So the real consequence: the board keeps showing slice 1 forever and never shows slice 2.** `model`, `contextTokens`, `lastActivity` would all render from a conversation that ended before the current slice began — **an agent row asserting live facts about a dead session**, from the moment any desk takes a second slice.

**It is quieter than the cost described, so nothing would surface it.**

## THE BLAST RADIUS IS `session`, and the plan never mentioned the field

The obvious repair — make `session` follow the hop — reaches nine consumers, including **the manifest's own filename** (`plot-dispatch.sh:1449`), the React key for every agent row, the rendered agent name, Drop's payload, and `performer.assignSlice`. So `session` cannot simply be rewritten.

The plan's *"What this does NOT do"* was silent on it, which would have let an implementer read it as out of scope and ship the stale join.

## THE IDLE RULE DOES NOT STOP FIRING

The plan claimed a fresh conversation starts fast, so the rule goes quiet *by accident*.

`plot-transcript-quiet.sh:27-32` reads the newest mtime across every non-`agent-` transcript in the **desk directory** and declines a session id by design — verified:

> `.plot/worker-prompt.sh:29` DOES pass `--session-id` now … and this deliberately does not take it.

A fresh handle writes a new file in the same directory. While it loads a brief and a repo, nothing writes at all, and the CPU check only rescues a worker with a child **on a core** — a model round-trip is not.

**The idle rule is an independent live defect, not this fix's second half.** Filing it as *"rarer now"* files on a false premise.

## THE OPERATOR'S CAUSAL STORY IS UNVERIFIED

The plan repeated *"those commits were 861's, still on the reused desk"*. `reset_desk` detaches to `origin/<main>` before cutting the branch (`plot-worker-loop.sh:928`), and `monitor_has_commits` counts against `origin/HEAD` excluding the claim commit. **On a properly reset desk the condition should have refused.** Either the reset fell through, or the branch carried pushed work. The slice establishes which.

## Upheld

The rule — *a hand-over to a different branch mints a new handle* — and the location. `update_manifest_on_hop` is the only writer of `resumeId`, the only site with both branches, and the hop is its only caller.

**And `--restart` is explained:** it routes through `start_worker`, which mints an id and writes a brand-new manifest. It is a *new agent*, which is why the operator's recovery worked and why it is not the fix.

**One path named rather than discovered:** a resumed loop on a pre-`resumeId` manifest falls through to `$PLOT_SESSION_ID` and never reaches the comparison.

## Why not `proceed`

The juror's own reason, and it is the sharpest sentence of the session: **the plan wrote *"It may not discover this in review"* about precisely the board question, then stated the answer backwards** — pre-committing an implementer to the wrong repair for a consequence quieter than the one described.

## Amendments folded in

1. The cost inverted, with `registry.ts:788` and the docstring that forbids the assumption.
2. The `session`-vs-`resumeId` decision added to the Design, with the nine-consumer blast radius.
3. The idle rule restated as independent, with `plot-transcript-quiet.sh`'s own comment.
4. The commits claim marked unverified, with `reset_desk:928`.
5. The pre-`resumeId` path named; `--restart` explained.
