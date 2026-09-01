---
'plot': patch
---

`plot-plan-meta.sh` stops letting an unfilled placeholder beat a real transition record. The four scalar records — `Design:`, `Approved:`, `Released:`, `Delivered:` — took the first matching line and called `strip_placeholder` afterwards, in `emit_record`, so a plan holding both `- **Delivered:** <!-- YYYY-MM-DD -->` and a real `- **Delivered:** 2026-09-01` reported whichever came first: the placeholder claimed the slot, was emptied a moment later, and the record it beat was gone. Seven plans here write their placeholders as per-line comments rather than the template's block, and `a-machine-is-an-instance` parsed correctly on 2026-09-01 only because `append_delivered_line` stops at the first `<!--` and so appended two lines above the placeholder rather than filling it. A delivered plan reading `delivered_raw: ""` is invisible to the scan, which takes its rolling window from that field. The four now filter at capture, as `started` always has because a list had to, so which line comes first no longer decides. Measured across all 192 plans in this repo: zero parse differently.

<!--
bumps:
  skills:
    plot: patch
-->
