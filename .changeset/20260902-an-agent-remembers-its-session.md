---
'plot': minor
---

An agent's manifest carries a resume handle and an attempt count. `resumeId` holds the same value as `session` at launch and is kept separate because the two have different lifetimes — `session` is the transcript join key and stays fixed across a branch hop, while whether the resume handle should follow a hop cannot be asked while one field carries both meanings. `attempts` is the supervisor's own counter rather than a share of `relaunches`, so a person's manual restarts do not exhaust an automatic budget. A domain rule decides whether resume is available at all.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
