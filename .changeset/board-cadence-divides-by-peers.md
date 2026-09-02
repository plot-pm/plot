---
'@plot-pm/board': minor
'@plot-pm/domain': minor
---

The board's PR refresh interval divides by what the account is observed to be spending, so two boards spend what one board spends. Counted from the budget record over 400 adjustments: one board holds the account at 60 requests an hour, and so do two, three, five and eight — each board reaching an interval of N times the 60 s it refreshes at alone. A third board changes that number by nothing.

No peer counting. The rate is read from the record every spender appends to, which also carries the operator's own `gh` calls and a dispatched worker's scans; a headcount of boards would miss both. `plot-host.sh spend-rate` supplies it, reads a file and asks no host.

One board on a quiet account is unchanged and refreshes exactly every 60 s. An absent rate — a record holding one line, or several written inside one millisecond — leaves the cadence where it is rather than collapsing it, and a board already stretched holds position on it rather than walking back: null is no evidence, while a rate that is zero is evidence of an idle account. The stretch is bounded at eight, because the rate is read over a window as short as the gap between two lines and a burst must not push a board somewhere it has stopped spending enough to return from.
