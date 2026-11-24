---
'plot': minor
---

A new `## Plot Config` key, `Slice max tokens`, caps the tokens one slice's runs may total on either runner. Before each run the worker loop sums the slice's input, output and cache-creation tokens from the slice-spend record and the desk's unsealed session transcripts; cache-read tokens count zero. A slice at or above the cap starts no further run and ends `spend-limit`. An absent or blank key sets no limit, and a present value that is not a positive whole number refuses the worker's start.

<!--
plan: docs/plans/2026-11-23-the-default-runner-has-a-spend-cap.md
bumps:
  skills:
    plot: minor
-->
