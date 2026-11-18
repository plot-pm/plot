---
'plot': patch
---

The board's write routes accept a request from an origin that `PLOT_BOARD_ORIGINS` declares, in addition to the three loopback origins. Set it to a `tailscale serve` address, for example `PLOT_BOARD_ORIGINS=https://machine.tailnet.ts.net`, to use the board's buttons from another device on the tailnet while the board stays bound to loopback. A list takes several origins, separated by commas. An entry that is not an exact origin is ignored. The passkey check still accepts only `http://localhost`, so a release is approved at the machine.
