---
'plot': patch
---

The controller gate and the CI-suite gate split a command at a separator only when the shell reads it as an operator. A `|`, `;` or `&&` inside quotes or after a backslash no longer starts a new command, so `grep "a\|plot-deliver.mjs" README.md` reads as a read, and `cat it\'s; pnpm run test:e2e; cat 'y'` is refused at a fleet desk.

<!--
bumps:
  skills:
    plot: patch
-->
