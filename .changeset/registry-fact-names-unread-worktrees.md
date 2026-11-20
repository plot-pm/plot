---
'plot': patch
---

The Fleet card's WORKING header no longer counts a worktree whose state the board could not read as an agent with no registry file or as an agent that is not working. It names those worktrees in their own amber sentence: "the board could not read the state of 13 worktrees". The registry fact "N of M agents have no registry file" counts only agents whose state was read, and the registry read reports the new `unreadCount`.

<!--
bumps:
  skills:
    plot: patch
-->
