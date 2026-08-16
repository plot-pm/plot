---
"plot": patch
---

`plot-update-board.sh` gains a test.

It had none, which is why a missing transition — new implementation PRs never reaching *Ready* — survived five months before #98 closed it. A board update that never happens is indistinguishable from a board nobody configured: nothing fails loudly, so nothing but a test could have caught it.

The happy path needs a real GitHub Project, so the suite pins everything around it, which is where the failure actually lived. `gh` is PATH-stubbed per subcommand and every run happens in a throwaway git repo, so the tests are fully offline and never touch the host repo's board cache.

**Argument handling.** Zero through three arguments exit 1 with the usage string, and never reach `gh`; four arguments do not exit 1 and drive the full `view → item-add → field-list → item-edit` sequence, with the status argument selecting the matching option id.

**Graceful degradation.** All six unreachable-board paths — unresolvable project, failed `item-add`, failed `field-list`, a project with no Status field, an unknown status option, a failing `item-edit` — exit **0** with their warning on stderr rather than stdout. So does a `gh` that is missing from PATH entirely, and so does a run from outside any git repo. This is the load-bearing behaviour: the script is called from skills that must not fail when no board is configured, and it is exactly why the missing call was silent.

**Every status has a caller.** Each of `Planning`, `Ready`, and `Done` appears in some `plot-update-board.sh` invocation under `skills/`. This is deliberately a test about skills rather than about the script — the defect was never in `plot-update-board.sh`, it was in nobody calling it. Deleting the `Ready` caller reproduces #98 and fails exactly this test and no other.

It asserts the status **set**, not skill-to-status pairs. Pinning `plot-approve → Ready` would be stricter and would also catch "the wrong skill calls it" — but it would break on exactly the kind of restructuring that caused the gap: Plot 2 moved branch creation from `/plot-approve` to `/plot-implement`, and a pair-based test would have gone red for a legitimate move while staying silent about the transition actually disappearing. A companion test guards the three against passing vacuously if the grep or the argument shape ever drifts.

Two further properties ride along because they are cheap and were never pinned: project metadata is cached under `.git/` rather than into the working tree (and a second run reuses it, skipping `view` and `field-list`), and the script uses no bash-4-only constructs, since macOS ships bash 3.2.

Assertions are per line rather than whole-output regexes — this suite has been fooled three times by patterns matching across report lines. Each test was verified to fail under a targeted mutation of the behaviour it claims to pin.

No skill version bump: this adds coverage only — `plot-update-board.sh` and every skill that calls it are unchanged.
