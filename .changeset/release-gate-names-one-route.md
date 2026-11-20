---
'plot': patch
---

The controller gate's two release refusals name one shell route: a receipt from `plot-state-receipt.sh --unowned-action release <slug>`, then `plot-deliver.mjs --release <version> <slug>`. The HTTP refusal no longer names the bundle alone with its arguments reversed, and the bundle refusal no longer sends an agent to `POST /api/release`, which the gate refuses from a shell.
