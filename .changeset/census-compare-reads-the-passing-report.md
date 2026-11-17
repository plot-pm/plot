---
'plot': patch
---

CI's `census-compare` job now compares only a passing `census-head` report. A failed census uploads its report under `census-failed-head-<attempt>`, so a re-run that passes is no longer compared against the failed attempt's report.
