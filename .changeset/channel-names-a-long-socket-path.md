---
'plot': patch
---

The fleet channel names a socket path too long to bind: where `listen` fails with `EINVAL` or `ENAMETOOLONG`, fleetd's warning states the path's byte length and the 104-byte limit macOS sets, in place of a bare `listen EINVAL`. A failed bind also stops the channel's heartbeat timer.
