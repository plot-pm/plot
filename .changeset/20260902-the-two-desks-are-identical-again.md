---
'plot': patch
---

Revert the e2e fixture sleep added in #640. Holding one agent alive past its push broke the control test beside it, whose premise is that the two desks are identical and only the host's answer differs — main went red on the merge commit and green again on the revert. The rare CI-only flake it tried to fix is left standing, with the dead end recorded.
