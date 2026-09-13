---
'plot': patch
---

A charter naming a harness this machine cannot run refuses the launch and names what it looked for. Measured on main 2026-09-13, a charter reading `"harness": "no-such-harness-xyz"` resolved `declared` with exit 0 and the launch proceeded — the work then done by whatever the prompt file falls back to, under the repo default, successfully, with nothing saying the wrong agent ran. `resolve_launch` now asks `command -v` on the resolved harness, the same question the prompt file asks when it interpolates the name, and refuses through the arm it already has. The check sits on the `declared` arm because the two arms around it have already blanked the field. A charter naming no harness — the estate's whole population — launches exactly as before.

<!--
plan: docs/plans/2026-09-13-a-harness-this-machine-cannot-run-refuses.md
bumps:
  skills:
    plot: patch
-->
