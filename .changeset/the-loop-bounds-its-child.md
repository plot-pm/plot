---
"@plot-pm/board": patch
---

plot: a hung child does not hold the loop

`plot-worker-loop.sh` sourced its prompt at line 88 and waited for it to
return. When the agent CLI crashed WITHOUT exiting — the `Error: No messages
returned` rejection thrown inside its own process, which leaves it alive but
never returning — the loop waited forever. Measured 2026-08-25: 13 live
workers, 11 of them with an already-merged PR, all stuck on that line; one for
10 hours.

The prompt now runs under a wall-clock bound. When it fires the worker logs why
and **exits** — it does not hop to the next wave, because a hung agent left the
worktree in a state nobody measured and starting a second branch on that guess
is worse than stopping.

The bound is **bash alone**. `timeout(1)` cannot wrap a `source` (it execs a
process; `. ` is a builtin), and it is not assumable anyway — measured here it
resolves to Homebrew coreutils, absent on a bare mac. So a background watchdog
sends `SIGALRM` to the loop after the bound; a trap kills the prompt tree and
the loop plain-`wait`s. This uses only builtins present in bash 3.2, which is
the stock `/bin/bash` on exactly the Homebrew-free mac that also lacks
`timeout(1)` — an earlier `wait -n` design silently disabled the bound there.

The duration is a `## Plot Config` key, **Worker bound**, defaulting to 3600s
(~1 h): honest runs on this estate were 9–29 min against hangs of up to 10
hours, so the default never truncates real work. `0` disables it.

A single `EXIT` trap reaps the prompt tree and the watchdog on every exit path —
a normal finish, a timeout, a Ctrl-C, and an outright kill of the loop — so the
bound leaves no orphaned `sleep` behind.
