---
'plot': patch
---

Pin `changesets/action` below v2, which refuses the Changesets CLI this repo declares. The v2 action errors on CLI v2 and renamed the four inputs the release workflow passes, so a SHA-only bump broke the Release job on every commit after it and stopped the release PR regenerating.
