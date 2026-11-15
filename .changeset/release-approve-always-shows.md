---
'@plot-pm/board': patch
---

The release row's "Approve release" button always shows. Where the release PR is not ready, the button is disabled and names the first unmet criterion: CI has not reported, is running or is failing on the head, the review is missing, running, failed or names an older head, or no passkey is registered.
