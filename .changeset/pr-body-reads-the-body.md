---
'plot': patch
---

`plot-host.sh pr-body <pr>` with no flag prints the pull request's description, over REST on GitHub and from `bb pr view --json` on Bitbucket. `/plot-reslice` step 3 reads a branch's PR body with it; before this change that call refused with "pr-body needs --body or --body-file".

<!--
bumps:
  skills:
    plot: patch
    plot-reslice: patch
-->
