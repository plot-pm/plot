---
'plot': minor
---

The board supersedes a plan: every plan card shows a Supersede action, enabled for a Draft, Design or Approved plan and disabled with the plan's state as its reason otherwise. The action asks for the successor's slug, with the board's other plans as suggestions, and posts to the new route `POST /api/supersede`, which runs the `plot-supersede.mjs` supersession and answers with its summary or its refusal.
