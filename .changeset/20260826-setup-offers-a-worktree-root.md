---
---

`/plot-board-setup` proposes a `Worktree root`, and `plot-config.sh` documents
the key.

`plot-dispatch.sh` has read `Worktree root` since #445, defaulting to the repo's
parent — but the key appeared in no key list, no skill and no hub doc, so an
adopter had no way to discover that worktrees could live anywhere else. A key
that is read and undocumented is the mirror of the one `setup-names-an-unread-key`
warns about.

Setup now proposes `.worktrees` where nothing is configured, and refuses to write
the key unattended: the default is harmless, and a key written unasked would
relocate every future worktree in a repo nobody was consulted about.

<!--
bumps:
  skills:
    plot-board-setup: minor
    plot: patch
-->
