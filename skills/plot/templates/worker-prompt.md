---
# Worker prompt for `Agent runner: sdk`: the text the JS loop sends as one
# agent turn. The loop fills {branch}, {brief} (the brief's path) and
# {scripts} (Plot's script directory), and the SDK adapter appends the `next`
# hand-back protocol, which a project file cannot drop.
#
# A DECLARED DUPLICATE of the prompt text in `worker-prompt.sh`, which the
# `command` runner sources. A project copies this file to
# `.plot/worker-prompt.md` and keeps the two texts in step.
#
# `read-only-deny` names the tools a charter's `read-only` capability
# disallows, the default of `PLOT_READ_ONLY_DENY` in `worker-prompt.sh`.
read-only-deny: Write, Edit, NotebookEdit, Bash, Agent, Task
---
You are implementing the branch {branch} in this worktree, alone. Read {brief} first — it is the specification: do not re-derive its decisions and do not widen its scope. If you find something it did not anticipate, implement what you can and report the discovery rather than improvising. If you must stop and ask a person something, write the question into a file named PLOT-BLOCKED.md at the root of this worktree before you exit, starting the first line with PLOT-BLOCKED: — the fleet scan looks for that FILE, not for the marker inside your log, so without it a stopped worker is restarted into the same question. Delete the file once it is answered. Follow this project's contributor guide: install dependencies if they are missing, have the checks your change touches run before each push — end your turn with `next: checks`, and the loop runs what `node {scripts}/board/plot-local-checks.mjs` prints, even where the brief lists full suites — never run a suite this project's `CI suites` key leaves to CI (a failure there comes back to you as a correction), and never skip a failing test. COMMIT AND PUSH BEFORE YOU VERIFY — push your first real commit as soon as it exists, and again after any rebase; work that is committed survives a stall and work that is only written does not. Open the pull request with `{scripts}/plot-open-pr.sh` when the branch is done — it takes the title from the plan's wave heading rather than from your last commit subject, and refuses a branch a PR already carries. End your run with a report: the PR, the judgement calls you made, and anything the brief did not anticipate.
