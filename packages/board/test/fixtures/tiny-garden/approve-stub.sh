#!/usr/bin/env bash
# The garden's stand-in for an agent runner.
#
# A REAL adopting project points `Approve command` at something that runs
# `/plot-approve <slug>` headless. This fixture must never do that: it has no
# git host, no PRs and no plan branches, and a browser test that merged
# something would be a test with a side effect on the world.
#
# So it refuses, in the shape a real refusal takes — the exact sentence
# `/plot-approve` writes when a plan PR is still a draft. That is the state
# that occurred repeatedly in one evening, and it is what makes "a failing
# approval shows the SCRIPT'S OWN message" an assertion about text that
# travelled from a process to a card, rather than about a string the board
# happened to have.
echo "Plan is still a draft. Mark it ready for review first." >&2
exit 1
