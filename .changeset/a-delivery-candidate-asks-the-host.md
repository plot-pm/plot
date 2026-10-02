---
'@plot-pm/board': patch
---

The fleet scan asks the host about a delivery candidate's subject-proven branches again. Since the merge-subject rule landed, the scan asked only when `branch_readings` received a candidate argument that no caller passed. Every branch whose ref was deleted at merge kept `evidence: subject`, `allSlicesConfirmed` answered `unknown`, and auto-deliver and the Deliver control held every such plan. The scan now decides candidacy after the rule has stated each branch: an Approved plan whose every non-deferred branch reads `merged`. Under `HOST_VERDICT` `ok` or `partial` it asks `merged_by_host` about each subject-proven branch, and a host `MERGED` answer drops the `evidence` field.

<!--
bumps:
  skills:
    plot: patch
-->
