---
"plot": minor
---

`/plot-dispatch` now says in its **summary** why no worker started, and asks
once — at the first fan-out — how the project runs an agent headless.

`started=0` was always in the footer. The reason lived in per-branch output,
printed by `start_worker` after the fan-out had already happened. On 2026-08-17
that message was printed and missed five times: worktrees sat claimed with
nobody working on them, and the last line a caller read said `started=0` with
nothing beside it.

So the fact now travels twice, both in the summary block:

```
2 worktrees prepared, 0 workers started, no `Worker command` configured
summary: dispatched=2 reused=0 skipped=0 started=0 brief=missing worker=unconfigured
```

**The footer stays pure `key=value` and stays last**, as every footer in this
repo is — consumers read that one line, never the prose. The sentence sits above
it, the way the failed-booking note already does. In the footer it would have
been readable and unparseable; only in the footer, parseable and unread.

`worker=` has four values, because collapsing any two re-creates the defect this
change exists to remove — one label over states whose actions differ:

| Value | Means |
|---|---|
| `configured` | a `Worker command` exists |
| `unconfigured` | nobody has been asked |
| `declined` | `Worker command: none` — asked, and this repo starts them by hand |
| `suppressed` | `--no-start` |

**`declined` is not `unconfigured`.** `plot-config.sh` returns the default for a
missing key and an empty one alike, so an empty answer left blank would be
indistinguishable from never having asked — and the question would come back at
every fan-out. `none` is the repo's established sentinel for a deliberate
absence (`Implementation home: none`), and it is what makes *"I start them
myself"* a recordable answer rather than a deferral. It is never run as a
command: a worker per branch failing with `none: command not found` would turn a
decision into N crashes.

**The asking belongs to the skill, and to the first dispatch.** A bash script
cannot put a question to a human inside an agent session — scripts collect and
report, skills interpret — so the prompt lives in `skills/plot-dispatch/SKILL.md`
as step 3, after the dry run, with the count in hand. Not at `/plot-init`:
adoption runs long before anyone fans out work, so the question meets a need the
answerer does not have, gets a shrug, and writes an empty key nobody revisits —
an answered-and-wrong config is harder to fix than a missing one, because
nothing later notices it was never really decided.

**It asks; it never suggests.** No example command in the prompt. An example
becomes a template, and then Plot has effectively hardcoded a tool it is not
supposed to know (Principle 5). The problem was never *which* command — it was
that nobody learned the option existed.

**`--no-start` is untouched and means exactly what it says.** Its zero reports
as a choice, not a config gap; the inspect-first workflow was never the defect.
A `--dry-run` explains nothing at all — it starts nothing by construction, so
the line would be true, useless, and would train the reader to skip it on the
run where it matters.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
