---
'plot': patch
---

A worker loop that restarts itself onto the main checkout's newer bundle re-opens the desk's liveness token from its path, instead of handing the harness fd 3, which after `execve` holds the new Node's own kqueue and makes the spawn fail with `EBADF`. A bounded run whose held descriptor cannot be passed to the child now answers `failed` rather than crashing the loop.

<!--
bumps:
  skills:
    plot-dispatch: patch
-->
