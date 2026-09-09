#!/usr/bin/env bash
# Worker prompt: the `claude -p` invocation plot-worker-loop.sh runs each
# iteration. The loop SOURCES this file, so $PLOT_BRANCH, $PLOT_WORKTREE and
# the session variables expand at runtime and `claude` runs in the agent's
# worktree.
#
# THIS FILE IS THE PROJECT'S. Plot ships it as a starting point and reads
# nothing back out of it: what the agent is TOLD is the project's to write, and
# the wording below is deliberately short because a real project's is not.
# Replace the instructions with this project's own — the repo's gates, its
# commit and PR conventions, whatever an agent here must know.
#
# TWO LINES ARE PLOT'S, AND THEY ARE THE SESSION HANDLING BELOW. Keep them when
# you rewrite the rest. They are the half of the contract Plot exports and
# cannot write, and the paragraphs that follow say what each one costs to get
# wrong.
#
# THE FLAG IS THE LOOP'S DECISION, NOT THIS FILE'S. plot-dispatch.sh mints a
# session id and the loop exports it as PLOT_SESSION_ID, together with
# PLOT_SESSION_FLAG — `--session-id` on an agent's first prompt and `--resume`
# on every one after. The loop decides which by probing whether a transcript
# already exists under that id. This file interpolates the answer and states no
# rule of its own.
#
# THAT SPLIT IS WHY THE RULE IS NOT HERE. A prompt file that hardcodes
# `--session-id` works once: the id does not change when an agent hops to a
# second slice, so the runtime is asked to CREATE a session it already holds,
# answers `Session ID … is already in use`, and the prompt exits in under a
# second. Measured 2026-09-05, three agents failed that way simultaneously,
# every exit code zero and every board row reading `running`. Every project
# rewrites this file, so a rule written here is a rule that gets rewritten; an
# interpolated flag cannot be.
#
# THE DEFAULT IS `--session-id`, for a loop older than the export or a hand
# run. Asserting an id that turns out to be taken fails loudly in one second,
# where a bare `--resume` opens an interactive picker in a `-p` run with no
# terminal and hangs — that flag is optional-valued, so it does not refuse a
# blank value.
#
# AN ABSENT ID IS NOT AN EMPTY ONE. Run by hand, or by any caller that is not
# dispatch, this file has no PLOT_SESSION_ID, and `--session-id ""` is a
# malformed argument rather than a missing one. So the pair is built as an
# array that stays EMPTY when the variable is unset or blank: the run proceeds,
# its transcript is unattributable, and that is the honest answer.
#
# THE `${a[@]+"${a[@]}"}` FORM IS FOR BASH 3.2, WHICH IS `/bin/bash` ON MACOS.
# There, a plain `"${session_args[@]}"` on an EMPTY array expands to one empty
# argument — the exact malformed argument the guard exists to avoid — and under
# `set -u` it aborts with `session_args[@]: unbound variable` instead. Bash 5
# does neither. The loop sources this file through `bash -c`, which resolves on
# PATH, so the version is not knowable here and the portable form is the only
# correct one.
session_args=()
[ -n "${PLOT_SESSION_ID:-}" ] && session_args=("${PLOT_SESSION_FLAG:---session-id}" "$PLOT_SESSION_ID")

claude -p "You are implementing the branch $PLOT_BRANCH in this worktree, alone. Read .plot/briefs/${PLOT_BRANCH##*/}.md first — it is the specification: do not re-derive its decisions and do not widen its scope. If you find something it did not anticipate, implement what you can and report the discovery rather than improvising. If you must stop and ask a person something, write the question into a file named PLOT-BLOCKED.md at the root of this worktree before you exit, starting the first line with PLOT-BLOCKED: — the fleet scan looks for that FILE, not for the marker inside your log, so without it a stopped worker is restarted into the same question. Delete the file once it is answered. Follow this project's contributor guide: install dependencies if they are missing, run the repo's gates, and never skip a failing test. Run every test in the FOREGROUND: you are a \`-p\` run with no next turn, so a background job's completion never reaches you and the work is stranded uncommitted. COMMIT AND PUSH BEFORE YOU VERIFY — push your first real commit as soon as it exists, and again after any rebase; work that is committed survives a stall and work that is only written does not. Open the pull request with \`skills/plot/scripts/plot-open-pr.sh\` when the branch is done — it takes the title from the plan's wave heading rather than from your last commit subject, and refuses a branch a PR already carries. End your run with a report: the PR, the judgement calls you made, and anything the brief did not anticipate." ${session_args[@]+"${session_args[@]}"} --permission-mode bypassPermissions
