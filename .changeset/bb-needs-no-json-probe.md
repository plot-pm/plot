---
'plot': patch
---

A Bitbucket command in `plot-host.sh` calls `bb` with `--json` and no capability probe first. The probe (`bb pr list --help --json` and `bb --version` on the first `bb` call of every process) existed for craftamap/bb, which has no `--json`; Quatico `bb`, the one `bb` Plot supports, takes it in every release. The `bb` version that `bb_list_page_length` needs is now read only where a listing's last page leaves the page length to decide, and `PLOT_BB_SKIP_CAP_CHECK` is gone.

<!--
bumps:
  skills:
    plot: patch
-->
