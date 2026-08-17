---
"@plot-pm/board": minor
---

A row on the Agents tab now marks itself when something is actually being written to it, rather than when it happens to sit in the WORKING group.

**The dot was not too quiet; it was too uninformed.** `isLive` was the whole of `row.group === 'working'` — which is an *address*, not a pulse. A row keeps that address for **hours**: while an agent works, while an agent has crashed, and while it waits on a human. Nothing measures the end. Six rows carried the claim simultaneously during the session that reported this, and making it louder would only have amplified a statement the board cannot support.

Meanwhile the scan already produced the answer and threw it away. `local_dirty`, `local_locked` and `local_ahead` have been in the contract since #167 — `local_locked` reads `.git/index.lock` and was fought for the same day in `board-survives-its-agents`, on the argument that a locked worktree must become **its own signal rather than silence**. All three reached `classify()` inside `rowsFromPulse` and were dropped there. Producing a signal and never rendering it is a quieter version of the defect that plan fixed.

**A row is active when `local_locked || local_dirty`** — someone is writing, or has written and not committed. `local_ahead` is deliberately **not** part of it: unpushed commits are finished work sitting *still*, a real condition with a real remedy (push it) and no motion behind it. An implementation OR-ing all three passes every positive assertion this change makes and reports a branch nobody has touched for hours as though someone were typing into it. It earns a static mark of its own in a later wave.

**A seen lock echoes for 6 s.** Measured tension: `.git/index.lock` lives from a fraction of a second to a few seconds, and `FLEET_POLL_MS` is 4 s — so most locks are born and die *between* two pulses, and the sharpest signal the board has is the one it most often misses. Six seconds is longer than one poll (so a seen lock survives the next pulse, which is the entire point) and shorter than two (so it always clears). This is the one place the board lets a marker outlive its fact, and it is bounded by three rules, each with its own test: the echo **only ever adds**, so a pulse finding nothing neither clears it early nor extends it; a lock **never resurrects**, because the echo starts only where a lock was *seen*; and it is **a marker, not a state** — the row's note goes on reporting whatever the last pulse actually found, and each echo clears itself on its own timer rather than waiting for a pulse, which is what keeps a board whose server died from sitting lit.

**Absent is not false.** Both fields are `.default(false)`, and a scan that could not observe a worktree reports absence rather than cleanliness. So `false` yields **no mark** — never a mark reading *idle*. The strongest statement licensed here is *unknown, never nobody*.

**The marker names its own limit**, because a technically-correct marker can still mislead. Every signal behind it is local — `fleet.ts` is explicit that `local_dirty` is *"true only on the machine doing the looking, and false is what every branch elsewhere reports"* — so an agent on another machine produces **no mark here, ever**. Its branch is not idle; it is unobservable from this checkout. The marker says *a write is in progress in this checkout* rather than letting absence speak for itself.

**No existing mark was modified.** `isLive` and `[data-live-dot]` are untouched and still mean *in the WORKING group*; `[data-change-mark]` keeps its full-row amber wash. Three marks, three meanings — the standard #180 set when it shipped beside the dot rather than over it, and a row can carry all three at once. The activity mark is rendered minimally here on purpose: it reads the right thing before it is made prominent, because a glow over `group === 'working'` would have been a livelier lie.

The two fields had to be **forwarded onto `AgentRow`** to reach a component at all — they existed only on `FleetBranchSchema`, the raw scan document. Additive, both `.default(false)`, forwarded rather than re-derived so the group and the marker always answer from one reading of one scan. `classify()`, grouping and the scan itself are unchanged.

<!--
bumps:
  skills: {}
-->
