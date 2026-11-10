---
'@plot-pm/board': patch
---

The board reads the issue index while fleetd's heartbeat is live and its issue-reader loop is on time, and reads issues itself when that loop is late. A late scan or tick loop no longer sends issues to the board.
