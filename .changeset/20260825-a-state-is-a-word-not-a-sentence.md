---
'@plot-pm/board': patch
---

A running agent's state reads `running`, not a sentence

`agentStateStatus` mapped four of five registry states to their own name and one
— `running` — to `someone is on it`. Reported from a running board on
2026-08-25, in the reader's own words: *"'someone is on it' is no agent status."*

The five states now share one vocabulary. `running` renders `running`, in the
same one-word grammar its four siblings use. The withdrawn sentence answered a
different question — *should you worry about this row?* — and read identically on
every WORKING row (11 of 11, measured), so the column described nothing. The
function's own docstring already made the case: *a row whose usual state is a lie
teaches its reader to ignore the row* — and a word that is always the same
teaches the same lesson by being uninformative.

The 18 assertions of `someone is on it` across 8 files are **rewritten, not
deleted**: the browser case named *reads "someone is on it" for a running worker*
becomes the assertion that a running worker reads `running`, with its docstring
saying why the earlier contract was withdrawn.

`AgentStateSchema` is unchanged — still five members, its size pinned by a test.
The idle distinction (a running worker whose child has gone quiet) is a CUE, not
a sixth state, and is wave `Marked`'s subject.

The startability verdict `someone-is-on-it` (a `wip`/`claimed` branch a reader
may not start) is a separate contract in `PlanStartabilitySchema` and is
untouched — a different question, in a different column, that this plan does not
address.
