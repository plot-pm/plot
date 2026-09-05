#!/usr/bin/env bash
# Worker prompt: the claude -p invocation the loop script runs each iteration.
# Sourced by plot-worker-loop.sh — $PLOT_BRANCH, $PLOT_WORKTREE etc. are
# expanded at runtime, and `claude` is invoked in the current worktree.

# THE SESSION ARGUMENTS ARE PASSED ONLY WHEN THERE IS AN ID. plot-dispatch.sh
# mints an id and plot-worker-loop.sh exports it as PLOT_SESSION_ID; passing it
# makes the runtime write its transcript under the id the manifest already
# records, which is what lets the board join an agent to its transcript and lets
# a correction resume the same conversation. This file is the only place that
# half of the contract can be fulfilled — Plot exports the variables and cannot
# write the invocation.
#
# THE FLAG IS THE LOOP'S DECISION, NOT THIS FILE'S. PLOT_SESSION_FLAG is
# `--session-id` on an agent's first prompt and `--resume` on every one after,
# and the loop decides which by probing whether a transcript exists under the
# id. This file interpolates the answer and states no rule of its own.
#
# THAT IS WHY THE RULE IS NOT HERE. Until 2026-09-05 this line read
# `(--session-id "$PLOT_SESSION_ID")`, and PLOT_SESSION_ID does not change when
# an agent hops to a second slice — so the runtime was asked to CREATE a session
# it already held, answered `Session ID … is already in use`, and the prompt
# exited in under a second. Three agents failed that way simultaneously. This
# file belongs to the adopting project and every project rewrites it, so a rule
# written here is a rule that gets rewritten; a finished flag cannot be.
#
# THE DEFAULT IS `--session-id`, for a loop older than the export or a hand run.
# It is the value that was hardcoded here before, so an unset variable behaves
# exactly as this file did — and asserting an id that turns out to be taken
# fails loudly in one second, where a bare `--resume` would open an interactive
# picker in a `-p` run with no terminal and hang. A blank value must never reach
# `--resume`: that flag is optional-valued, so it does not refuse one.
#
# AN ABSENT ID IS NOT AN EMPTY ONE. Run by hand, or by any caller that is not
# dispatch, this file has no PLOT_SESSION_ID, and `--session-id ""` is a
# malformed argument rather than a missing one. So the flag is built as an array
# and stays EMPTY when the variable is unset or blank: the run proceeds exactly
# as it did before, its transcript is unattributable, and that is the honest
# answer. No id is invented here — an unanswerable question is not answered
# zero, the same direction plot-worker-state.sh already takes.
#
# THE `${a[@]+"${a[@]}"}` FORM IS FOR BASH 3.2, WHICH IS `/bin/bash` ON MACOS.
# Measured 2026-09-04: there, a plain `"${session_args[@]}"` on an EMPTY array
# expands to one empty argument, so `claude` would receive a stray `""` — the
# exact malformed argument this guard exists to avoid — and under `set -u` it
# aborts with `session_args[@]: unbound variable` instead. Bash 5 does neither.
# The loop sources this file through `bash -c`, which resolves on PATH, so the
# version is not knowable here and the portable form is the only correct one.
session_args=()
[ -n "${PLOT_SESSION_ID:-}" ] && session_args=("${PLOT_SESSION_FLAG:---session-id}" "$PLOT_SESSION_ID")

claude -p "You are implementing the branch $PLOT_BRANCH in this worktree, alone. Read .plot/briefs/${PLOT_BRANCH##*/}.md first — it is the specification, and its decisions were settled during plan interrogation: do not re-derive them, do not widen the scope. If you find something it did not anticipate, implement what you can and report the discovery rather than improvising. If you must stop and ask a person something, write your question into a file named PLOT-BLOCKED.md at the root of this worktree before you exit — start the first line with PLOT-BLOCKED: followed by the question. The fleet scan looks for a PLOT-BLOCKED* file in the tree, not for the marker string inside your log or your work, so a stopped worker is distinguishable from a finished one only if the file exists; without it a stopped worker is restarted into the same question. Delete the PLOT-BLOCKED.md file once it is answered. Follow CLAUDE.md: pnpm install if node_modules is missing, never skip tests, run pnpm build:board in THIS worktree and commit the artifact, add a changeset with its bumps block, never edit versions by hand, use trash not rm. Run every test in the FOREGROUND and never end a turn waiting to be notified: you are a \`-p\` run with no next turn, so a background job's completion never reaches you and the work is stranded uncommitted — measured three times on 2026-08-23, each losing a finished branch to an exit that looked like success. COMMIT AND PUSH BEFORE YOU VERIFY: push your first real commit as soon as it exists, and push again immediately after any rebase. Work that is committed survives a stall; work that is only written does not. Open a PR to main when done, then append the PR number to this branch's line in the plan's Branches section on main — check git branch --show-current is main before that edit. GitHub's API has returned 503 intermittently; if a push or merge appears to fail, verify the result via gh api rather than trusting the error. End your run with a report: the PR number, the judgement calls you made, and anything the plan did not anticipate." ${session_args[@]+"${session_args[@]}"} --permission-mode bypassPermissions
