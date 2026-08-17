---
"plot": minor
---

A Draft card shows how hard its plan has been questioned.

`/plot:challenge-the-plan` records its state in the plan file as a multi-line HTML comment. The parser's standing rule is that multi-line comment interiors are non-content — template guidance blocks live there — so the round it writes was invisible to everything downstream. Measured on 2026-08-17: `plot-plan-meta.sh` returned 22 keys for `docs/plans/2026-08-17-acting-buttons-show-they-act.md`, and `round` was not among them, although the file carries `"round": 2`.

**The parser reports it.** `plot-plan-meta.sh` gains a `rounds` field, read from the block via its `CHALLENGE-THE-PLAN-METADATA` sentinel rather than by recognising "a comment that looks like JSON". Keying on the sentinel is what keeps the general rule intact: `canonical-comment-block.md` still parses as all-absent, and a guidance comment still contributes nothing.

**Absent is not zero, and the field is omitted rather than defaulted.** `0 rounds` reads as *interrogated and found nothing*; a missing block means *nobody has looked*. Those want opposite reactions from a reader, so the key is left out of the JSON entirely and carried as `.optional()` through the contract — the same rule, for the same reason, that `claimed` and `eligible` already follow on `WaveSummarySchema`. A recorded `0` survives as `0` and stays distinguishable from both.

**The badge is Draft-only.** Past Discovery the count is history: approval settled the question it answers, and a number nobody acts on is the crowding this board keeps removing. The split is deliberate — the SERVER carries `rounds` for any plan that records one, and the CLIENT decides where to show it (`roundsBadgeText`), so a display rule stays in display logic rather than making the data field mean different things per column.

**The agent row does not gain it.** A row is a statement about one branch, and most rows name a plan whose design phase closed long ago; attaching a design-time count there would put it on every one of them. Card-only, the same split `waveSummary` already follows, and pinned by a test asserting the field is absent from `AgentRowSchema`.

**A malformed block costs only the round.** `plot-plan-meta.sh` is the plan-format contract and every other command depends on it, so a truncated or non-JSON metadata comment must not cost a plan its phase, type or branches. It does not; the round is simply absent.

The script collects and does not interpret (Manifesto Principle 3): it reports the number it finds, with no judgement about whether two rounds is enough.

Tests assert against **real plan files** in `docs/plans`, not hand-made fixtures. That is load-bearing here rather than stylistic: a fixture-shaped test would have passed against a format the skill does not emit, which is exactly how the field came to be missing in the first place.

<!--
bumps:
  skills:
    plot: minor
-->
