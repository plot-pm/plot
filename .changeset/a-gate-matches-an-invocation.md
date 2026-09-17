---
'plot': patch
---

`plot-controller-gate.sh` reads a single-quoted heredoc body as data rather than as a command. A commit message explaining which script performed a write was refused as though it were that script, and renaming the script to "the approval" in the prose let the identical commit through — so the gate bought nothing and cost the traceability `CLAUDE.md` asks for, which wants that reasoning in the commit "so `git log -S` finds it". Only the quoted form is stripped: `<<'EOF'` names its terminator literally and the body ends at a line equal to it, which is a scan for a known word rather than a shell grammar, while an unquoted `<<EOF` interpolates and its body can carry a substitution that is a command, so it stays tokenised. Command-position matching was this fix's first answer and a panel reversed it: the gate exists for "five dispatches in one session", the natural spelling of which is a loop, and a loop body is not command position — so that fix would have been blind to the defect the gate was built for. Nothing about which actions are gated changes, and reads of a gated script keep refusing, deliberately. The strip runs once before both readers of the command, which closes a pre-existing false negative: a heredoc body containing the word `--dry-run` used to exempt a real invocation sharing its command line. Sixteen invocation shapes are now pinned as a corpus inside the contract test, verified by mutation against the pre-fix gate.

<!--
plan: docs/plans/2026-09-17-a-gate-matches-an-invocation.md
bumps:
  skills:
    plot: patch
-->
