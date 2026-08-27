---
"plot": minor
---

`plot-dispatch.sh` refuses to launch a worker for a branch with no brief.

The worker's first instruction is *"Read `.plot/briefs/<branch>.md` first — it
is the specification"*. When that file is absent the worker reads nothing and
improvises — measured 2026-08-20 as an agent running 2:12 against a 700-line
wave with no spec. The script already **detected** the gap (`brief=missing` in
its footer) and started the worker anyway: a rule where a gate belongs, in
CLAUDE.md's exact sense — the condition was measured, printed, and not acted on.

**A missing brief PREPARES but does not START.** The worktree is created and the
claim is pushed — that work is correct and stays — but the worker launch is
refused, so the operator can write the brief and start it without redoing setup.
The refusal names the file and the two ways forward: write the brief with
`/plot-implement`, or pass `--no-brief`.

**`--no-brief` is the named escape**, in the tradition of `--allow-local`. It
starts the worker despite the missing brief and says so in the log, so the
override is on the record rather than silent.

**An unreadable brief is treated as missing, not present.** A zero-byte or
permission-denied file is not a specification — the assertion a naive `[ -f ]`
check fails — so the gate requires a readable, non-empty file. The footer's
`brief=missing` now agrees with what happened: it can no longer sit beside a
non-zero `started` unless `--no-brief` was passed. The plan gate and the
held-branch refusal are unchanged.

<!--
bumps:
  skills:
    plot: minor
-->
