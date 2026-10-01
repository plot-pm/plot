---
'plot': patch
'@plot-pm/board': patch
---

An absent or empty `Worker command` now starts agents on `plot-worker-loop.sh` beside the install, for `plot-dispatch.sh --start` and `--restart` alike (#1124). `--restart` used to refuse an absent key. The decision is the domain rule `startCommand`, asked through the `plot-start-command.mjs` bundle that replaces `plot-free-agent-command.mjs`: absent means the loop, `none` stays declined, and a free agent refuses a command that does not run the loop. That refusal's repair now names deleting the key first. A repository with no `.plot/worker-prompt.sh` runs the shipped `skills/plot/templates/worker-prompt.sh`: `resolvePrompt` answers `shipped`, and the loop logs one line when it uses the template. `--start` reports `worker=default` when the loop stands in for the key.

<!--
bumps:
  skills:
    plot-dispatch: patch
    plot: patch
-->
