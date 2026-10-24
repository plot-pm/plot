---
"plot": patch
---

The main-checkout gate refuses a mixed `git reset` (no `--hard`, `--soft`, `--keep` or `--merge`) in the main checkout for every unattended caller, including spawns marked `PLOT_MAIN_CHECKOUT_WRITER=1`, because it moves `HEAD` and leaves the working tree behind it.

<!--
plan: docs/plans/2026-10-24-a-mixed-reset-leaves-the-main.md
bumps:
  skills:
    plot: patch
-->
